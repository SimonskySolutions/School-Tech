import { type SystemDatabase, type SystemTransaction } from '../database/system-database';

// Seats held for an unpaid order are released when its checkout fails or its
// reservation time runs out. Order lines stay "pending" on an expired order,
// so a late payment can still confirm them (ADR 0010).

// A payment that is already processing is never expired from our side.
const EXPIRABLE_PAYMENT = ['created', 'pending', 'requires_action'];

/**
 * Releases one locked, unpaid order: "cancelled" after a failed payment (the
 * parent books again), "expired" when the time ran out (a late payment may
 * still be accepted).
 */
export async function releaseOrder(
  tx: SystemTransaction,
  orderId: string,
  outcome: 'cancelled' | 'expired',
  reason: string,
): Promise<void> {
  if (outcome === 'cancelled') {
    await tx.query(
      `UPDATE scheduling.booking SET status = 'cancelled', cancelled_at = now(), reserved_until = NULL, cancellation_reason = $2
        WHERE status = 'reserved' AND order_line_id IN (SELECT id FROM commerce.order_line WHERE order_id = $1)`,
      [orderId, reason],
    );
    await tx.query(
      `UPDATE commerce.stock_reservation SET status = 'cancelled', cancelled_at = now(), reserved_until = NULL
        WHERE status = 'reserved' AND order_line_id IN (SELECT id FROM commerce.order_line WHERE order_id = $1)`,
      [orderId],
    );
    await tx.query(
      `UPDATE commerce.order_line SET status = 'cancelled' WHERE order_id = $1 AND status = 'pending'`,
      [orderId],
    );
    await tx.query(
      `UPDATE commerce.customer_order SET status = 'cancelled', cancelled_at = now() WHERE id = $1`,
      [orderId],
    );
  } else {
    await tx.query(
      `UPDATE scheduling.booking SET status = 'expired', reserved_until = NULL
        WHERE status = 'reserved' AND order_line_id IN (SELECT id FROM commerce.order_line WHERE order_id = $1)`,
      [orderId],
    );
    await tx.query(
      `UPDATE commerce.stock_reservation SET status = 'expired', reserved_until = NULL
        WHERE status = 'reserved' AND order_line_id IN (SELECT id FROM commerce.order_line WHERE order_id = $1)`,
      [orderId],
    );
    await tx.query(`UPDATE commerce.customer_order SET status = 'expired' WHERE id = $1`, [orderId]);
    await tx.query(
      `UPDATE commerce.payment SET status = 'expired' WHERE order_id = $1 AND status = ANY($2)`,
      [orderId, EXPIRABLE_PAYMENT],
    );
  }
}

/** Expires unpaid orders whose reservation time has passed. Returns how many. */
export function expireReservations(database: SystemDatabase, batchSize = 200): Promise<number> {
  return database.withSystem('worker:reservation-expiry', async (tx) => {
    const orders = await tx.query<{ id: string; group_id: string }>(
      `SELECT id, group_id FROM commerce.customer_order
        WHERE status = 'pending_payment' AND expires_at <= now()
          AND NOT EXISTS (SELECT 1 FROM commerce.payment p WHERE p.order_id = customer_order.id AND p.status = 'processing')
        ORDER BY expires_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [batchSize],
    );
    for (const order of orders) {
      await releaseOrder(tx, order.id, 'expired', 'reservation expired');
      await tx.query(
        `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'commerce.order', $2, 'commerce.order.expired', $3)`,
        [order.group_id, order.id, JSON.stringify({ order_id: order.id })],
      );
    }
    return orders.length;
  });
}
