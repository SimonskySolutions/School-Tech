import { z } from 'zod';
import { messageParams } from '../notifications/templates';
import { type SystemDatabase } from '../database/system-database';
import { type OutboxJobData } from './outbox-relay';

// The parent's confirmation when an order is paid (M7.1, the open item from
// M2.5): queued once per order for the payer; the worker's sender delivers it.

const payloadSchema = z.object({ order_id: z.uuid() });

export function orderPaidNotice(database: SystemDatabase) {
  return async (event: OutboxJobData): Promise<void> => {
    const { order_id: orderId } = payloadSchema.parse(event.payload);
    await database.withSystem('worker:order-paid-notice', async (tx) => {
      const [order] = await tx.query<{
        group_id: string;
        payer_person_id: string;
        order_number: string;
        total_minor: string;
        currency: string;
        checkout_group_id: string;
      }>(
        `SELECT group_id, payer_person_id, order_number, total_minor, currency, checkout_group_id
           FROM commerce.customer_order WHERE id = $1`,
        [orderId],
      );
      if (!order) throw new Error(`order ${orderId} not found`);
      const params = messageParams('order.paid', {
        orderNumber: order.order_number,
        totalMinor: Number(order.total_minor),
        currency: order.currency.trim(),
        checkoutGroupId: order.checkout_group_id,
      });
      await tx.query('SELECT notify.queue_message($1, $2, $3, $4, $5)', [
        order.group_id,
        order.payer_person_id,
        'order.paid',
        `order:${orderId}`,
        JSON.stringify(params),
      ]);
    });
  };
}
