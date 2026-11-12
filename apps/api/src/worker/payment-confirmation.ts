import { type SystemDatabase, type SystemTransaction } from '../database/system-database';
import { parseProviderEvent } from '../payments/parse-event';
import { type ProviderEvent, type ProviderName } from '../payments/provider';
import { releaseOrder } from './reservations';

// Confirms payments from verified, stored provider events (ADR 0010). This is
// the only place a payment becomes "succeeded" and an order "paid". Each event
// is applied in its own savepoint inside one batch transaction, so one bad
// event never blocks the others, and every effect of one event (payment,
// order, lines, bookings, ledger, outbox) commits together or not at all.

export type ApplyResult = { status: 'processed' | 'ignored'; note: string };

interface PaymentRow {
  id: string;
  order_id: string;
  status: string;
  amount_minor: string;
  currency: string;
  provider_status_at: Date | null;
  order_status: string;
  group_id: string;
  payer_person_id: string;
  billing_entity_id: string;
}

const OPEN = ['created', 'pending', 'requires_action', 'processing'];

export async function applyProviderEvent(
  tx: SystemTransaction,
  provider: ProviderName,
  payload: unknown,
): Promise<ApplyResult> {
  const event = parseProviderEvent(provider, payload);
  if (!event) return { status: 'ignored', note: 'not an event type we act on' };

  // Lock the order before the payment, the same order the expiry job uses.
  const [target] = await tx.query<{ order_id: string }>(
    'SELECT order_id FROM commerce.payment WHERE provider = $1 AND provider_checkout_id = $2',
    [provider, event.checkoutId],
  );
  if (!target) return { status: 'ignored', note: 'no payment for this checkout' };
  await tx.query('SELECT 1 FROM commerce.customer_order WHERE id = $1 FOR UPDATE', [target.order_id]);
  const [payment] = await tx.query<PaymentRow>(
    `SELECT p.id, p.order_id, p.status, p.amount_minor, p.currency, p.provider_status_at,
            o.status AS order_status, o.group_id, o.payer_person_id, o.billing_entity_id
       FROM commerce.payment p JOIN commerce.customer_order o ON o.id = p.order_id
      WHERE p.provider = $1 AND p.provider_checkout_id = $2
      FOR UPDATE OF p`,
    [provider, event.checkoutId],
  );
  if (!payment) return { status: 'ignored', note: 'no payment for this checkout' };

  // Out of order: an event older than what we already applied changes nothing.
  if (payment.provider_status_at && event.createdAt <= payment.provider_status_at) {
    return { status: 'ignored', note: 'older than the current payment state' };
  }
  if (
    event.amountMinor !== null &&
    (event.amountMinor !== Number(payment.amount_minor) || event.currency !== payment.currency)
  ) {
    // Never confirm a payment for a different amount: leave it for a person to look at.
    throw new Error(
      `amount mismatch: provider ${event.amountMinor} ${event.currency}, payment ${payment.amount_minor} ${payment.currency}`,
    );
  }

  switch (event.outcome) {
    case 'succeeded':
      return succeed(tx, payment, event);
    case 'failed':
      return close(tx, payment, event, 'failed');
    case 'expired':
      return close(tx, payment, event, 'expired');
    case 'pending':
      if (!OPEN.includes(payment.status))
        return { status: 'ignored', note: `payment already ${payment.status}` };
      await tx.query(
        `UPDATE commerce.payment SET status = 'processing', provider_status = $2, provider_status_at = $3 WHERE id = $1`,
        [payment.id, event.type, event.createdAt],
      );
      return { status: 'processed', note: 'payment processing' };
  }
}

async function close(
  tx: SystemTransaction,
  payment: PaymentRow,
  event: ProviderEvent,
  status: 'failed' | 'expired',
): Promise<ApplyResult> {
  // A payment already processing (a bank debit, say) can only succeed or fail.
  const closable = status === 'failed' ? OPEN : OPEN.filter((open) => open !== 'processing');
  if (!closable.includes(payment.status))
    return { status: 'ignored', note: `payment already ${payment.status}` };
  await tx.query(
    `UPDATE commerce.payment SET status = $2, failure_code = $3, provider_status = $4, provider_status_at = $5 WHERE id = $1`,
    [payment.id, status, event.failureCode, event.type, event.createdAt],
  );
  // The provider will not take this payment any more: give the seats back.
  if (payment.order_status === 'pending_payment') {
    await releaseOrder(
      tx,
      payment.order_id,
      status === 'failed' ? 'cancelled' : 'expired',
      status === 'failed' ? 'payment failed' : 'checkout expired',
    );
  }
  return { status: 'processed', note: `payment ${status}` };
}

async function succeed(
  tx: SystemTransaction,
  payment: PaymentRow,
  event: ProviderEvent,
): Promise<ApplyResult> {
  if (payment.status === 'succeeded') return { status: 'ignored', note: 'payment already succeeded' };
  if (payment.status === 'failed' || payment.status === 'cancelled') {
    throw new Error(`provider reports success for a payment recorded as ${payment.status}`);
  }
  if (!['pending_payment', 'expired'].includes(payment.order_status)) {
    throw new Error(`payment succeeded for an order that is ${payment.order_status}`);
  }

  await tx.query(
    `UPDATE commerce.payment
        SET status = 'succeeded', succeeded_at = now(), provider_payment_id = $2, provider_status = $3, provider_status_at = $4
      WHERE id = $1`,
    [payment.id, event.providerPaymentId, event.type, event.createdAt],
  );
  await tx.query(`UPDATE commerce.customer_order SET status = 'paid', paid_at = now() WHERE id = $1`, [
    payment.order_id,
  ]);

  const lines = await tx.query<{ id: string; school_id: string; line_total_minor: string; currency: string }>(
    'SELECT id, school_id, line_total_minor, currency FROM commerce.order_line WHERE order_id = $1 ORDER BY line_no',
    [payment.order_id],
  );
  let credited = 0;
  for (const line of lines) {
    await tx.query(
      `INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, payment_id, currency, amount_minor)
       VALUES ($1, $2, $3, $4, 'payment', $5, $6, $7)`,
      [
        payment.group_id,
        line.id,
        payment.billing_entity_id,
        line.school_id,
        payment.id,
        line.currency,
        line.line_total_minor,
      ],
    );
    if (await confirmBookings(tx, line.id)) {
      await tx.query(`UPDATE commerce.order_line SET status = 'confirmed' WHERE id = $1`, [line.id]);
    } else {
      // Late payment, seat gone: the money becomes credit with the same company.
      await creditLine(tx, payment, line);
      credited += 1;
    }
  }

  await tx.query(
    `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'commerce.order', $2, 'commerce.order.paid', $3)`,
    [
      payment.group_id,
      payment.order_id,
      JSON.stringify({ order_id: payment.order_id, payment_id: payment.id, credited_lines: credited }),
    ],
  );
  return {
    status: 'processed',
    note: credited ? `paid; ${credited} line(s) credited, session full` : 'paid',
  };
}

/**
 * Confirms every booking and stock reservation of a line; false (and nothing
 * confirmed) if a seat or an item is no longer available.
 */
async function confirmBookings(tx: SystemTransaction, lineId: string): Promise<boolean> {
  await tx.query('SAVEPOINT confirm_line');
  try {
    await tx.query(
      `UPDATE scheduling.booking SET status = 'confirmed', confirmed_at = now()
        WHERE order_line_id = $1 AND status IN ('reserved', 'expired')`,
      [lineId],
    );
    await tx.query(
      `UPDATE commerce.stock_reservation SET status = 'confirmed', confirmed_at = now(), reserved_until = NULL
        WHERE order_line_id = $1 AND status IN ('reserved', 'expired')`,
      [lineId],
    );
    await tx.query('RELEASE SAVEPOINT confirm_line');
    return true;
  } catch (error) {
    await tx.query('ROLLBACK TO SAVEPOINT confirm_line');
    const code = (error as { code?: string }).code;
    if (code !== 'PY002' && code !== 'PY019') throw error;
    return false;
  }
}

async function creditLine(
  tx: SystemTransaction,
  payment: PaymentRow,
  line: { id: string; school_id: string; line_total_minor: string; currency: string },
): Promise<void> {
  await tx.query(
    `UPDATE scheduling.booking SET status = 'cancelled', cancelled_at = now(), cancellation_reason = 'late payment: session full'
      WHERE order_line_id = $1 AND status = 'reserved'`,
    [line.id],
  );
  const stock = await tx.query(
    `UPDATE commerce.stock_reservation SET status = 'cancelled', cancelled_at = now(), reserved_until = NULL
      WHERE order_line_id = $1 AND status IN ('reserved', 'expired') RETURNING id`,
    [line.id],
  );
  await tx.query(`UPDATE commerce.order_line SET status = 'cancelled' WHERE id = $1`, [line.id]);
  const [credit] = await tx.query<{ id: string }>(
    `INSERT INTO commerce.account_credit
       (group_id, billing_entity_id, holder_person_id, currency, original_amount_minor, remaining_amount_minor, reason, source_order_line_id)
     VALUES ($1, $2, $3, $4, $5, $5, $7, $6)
     RETURNING id`,
    [
      payment.group_id,
      payment.billing_entity_id,
      payment.payer_person_id,
      line.currency,
      line.line_total_minor,
      line.id,
      stock.length
        ? 'Paid after the reservation expired; the item was no longer in stock'
        : 'Paid after the reservation expired; the session was full',
    ],
  );
  await tx.query(
    `INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, credit_id, currency, amount_minor)
     VALUES ($1, $2, $3, $4, 'credit_issued', $5, $6, $7)`,
    [
      payment.group_id,
      line.id,
      payment.billing_entity_id,
      line.school_id,
      credit!.id,
      line.currency,
      -Number(line.line_total_minor),
    ],
  );
}

export interface EventLogger {
  warn(message: string): void;
  error(message: string): void;
}

/** Polls stored provider events and applies them, oldest first. */
export class PaymentEventProcessor {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly database: SystemDatabase,
    private readonly logger: EventLogger,
    private readonly options = { intervalMs: 1000, batchSize: 20, maxAttempts: 5 },
  ) {}

  processOnce(): Promise<{ processed: number; ignored: number; failed: number }> {
    return this.database.withSystem('worker:payment-events', async (tx) => {
      const events = await tx.query<{
        id: string;
        provider: ProviderName;
        provider_event_id: string;
        attempts: number;
        payload: unknown;
      }>(
        `SELECT id, provider, provider_event_id, attempts, payload FROM integration.inbound_event
          WHERE processing_status = 'received' AND provider IN ('development', 'stripe')
          ORDER BY provider_created_at, received_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.options.batchSize],
      );
      const result = { processed: 0, ignored: 0, failed: 0 };
      for (const event of events) {
        await tx.query('SAVEPOINT provider_event');
        try {
          const applied = await applyProviderEvent(tx, event.provider, event.payload);
          await tx.query('RELEASE SAVEPOINT provider_event');
          await tx.query(
            `UPDATE integration.inbound_event
                SET processing_status = $2, processed_at = now(), attempts = attempts + 1, last_error = $3
              WHERE id = $1`,
            [event.id, applied.status, applied.status === 'ignored' ? applied.note : null],
          );
          result[applied.status] += 1;
        } catch (error) {
          await tx.query('ROLLBACK TO SAVEPOINT provider_event');
          const message = error instanceof Error ? error.message.slice(0, 500) : 'unknown error';
          const final = event.attempts + 1 >= this.options.maxAttempts;
          await tx.query(
            `UPDATE integration.inbound_event SET processing_status = $2, attempts = attempts + 1, last_error = $3 WHERE id = $1`,
            [event.id, final ? 'failed' : 'received', message],
          );
          this.logger[final ? 'error' : 'warn'](`provider event ${event.provider_event_id}: ${message}`);
          result.failed += 1;
        }
      }
      return result;
    });
  }

  start(): void {
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.processOnce()
        .catch((error: unknown) =>
          this.logger.error(
            `payment event batch failed: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        )
        .finally(() => {
          this.running = undefined;
        });
    }, this.options.intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
