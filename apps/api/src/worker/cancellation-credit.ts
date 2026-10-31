import { z } from 'zod';
import { type SystemDatabase, type SystemTransaction } from '../database/system-database';
import { type OutboxJobData } from './outbox-relay';

// Turns a cancelled lunch day into account credit (M2.8, ADR 0008): exactly
// what was paid for that line, with the same billing entity, for the payer.
// Delivery is at least once, so the line is locked and an existing credit for
// it means the work is already done; a unique index backs that up.

const payloadSchema = z.object({
  order_line_id: z.uuid(),
  // Absent on cancellations by the school (M2.8); trips add a withdrawn permission (ADR 0023).
  // A fixed code, never free text: the outbox refuses keys that may carry personal data.
  cause: z.enum(['cancelled_by_school', 'consent_withdrawn']).optional(),
});

const CAUSES = {
  cancelled_by_school: 'Cancelled by the school',
  consent_withdrawn: 'Trip permission withdrawn',
} as const;

export type CreditOutcome = 'issued' | 'already-credited' | 'nothing-paid';

export async function issueCancellationCredit(
  tx: SystemTransaction,
  orderLineId: string,
  cause: keyof typeof CAUSES = 'cancelled_by_school',
): Promise<CreditOutcome> {
  const [line] = await tx.query<{
    id: string;
    status: string;
    group_id: string;
    school_id: string;
    billing_entity_id: string;
    currency: string;
    description: string;
    payer_person_id: string;
  }>(
    `SELECT l.id, l.status, l.group_id, l.school_id, l.billing_entity_id, l.currency, l.description, o.payer_person_id
       FROM commerce.order_line l JOIN commerce.customer_order o ON o.id = l.order_id
      WHERE l.id = $1
      FOR UPDATE OF l`,
    [orderLineId],
  );
  if (!line) throw new Error(`order line ${orderLineId} not found`);
  if (line.status !== 'cancelled')
    throw new Error(`order line ${orderLineId} is ${line.status}, not cancelled`);

  const [existing] = await tx.query<{ id: string }>(
    'SELECT id FROM commerce.account_credit WHERE source_order_line_id = $1',
    [orderLineId],
  );
  if (existing) return 'already-credited';

  const [paid] = await tx.query<{ net: string }>(
    'SELECT coalesce(sum(amount_minor), 0)::text AS net FROM commerce.payment_allocation WHERE order_line_id = $1',
    [orderLineId],
  );
  const amount = Number(paid!.net);
  if (amount <= 0) return 'nothing-paid';

  const [credit] = await tx.query<{ id: string }>(
    `INSERT INTO commerce.account_credit
       (group_id, billing_entity_id, holder_person_id, currency, original_amount_minor, remaining_amount_minor, reason, source_order_line_id)
     VALUES ($1, $2, $3, $4, $5, $5, $6, $7)
     RETURNING id`,
    [
      line.group_id,
      line.billing_entity_id,
      line.payer_person_id,
      line.currency,
      amount,
      `${CAUSES[cause]}: ${line.description}`.slice(0, 500),
      line.id,
    ],
  );
  await tx.query(
    `INSERT INTO commerce.payment_allocation (group_id, order_line_id, billing_entity_id, school_id, kind, credit_id, currency, amount_minor)
     VALUES ($1, $2, $3, $4, 'credit_issued', $5, $6, $7)`,
    [line.group_id, line.id, line.billing_entity_id, line.school_id, credit!.id, line.currency, -amount],
  );
  await tx.query(
    `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'commerce.account_credit', $2, 'commerce.credit.issued', $3)`,
    [line.group_id, credit!.id, JSON.stringify({ credit_id: credit!.id, order_line_id: line.id })],
  );
  return 'issued';
}

/** The "events" queue handler for commerce.order_line.cancelled. */
export function cancellationCreditHandler(database: SystemDatabase) {
  return async (event: OutboxJobData): Promise<void> => {
    const { order_line_id, cause } = payloadSchema.parse(event.payload);
    await database.withSystem('worker:cancellation-credit', (tx) =>
      issueCancellationCredit(tx, order_line_id, cause),
    );
  };
}
