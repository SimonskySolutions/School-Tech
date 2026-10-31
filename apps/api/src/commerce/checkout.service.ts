import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { type CheckoutGroupView, type CheckoutResponse } from '@pythagoras/shared';
import { type Principal } from '../auth/principal';
import {
  findBookableOfferings,
  findEligibilityProblems,
  findTripPermissions,
  findOpenSessions,
  findStudentWithSchools,
  type OfferingRow,
  type SessionRow,
} from '../catalog/catalog.repository';
import { findRoutes } from '../transport/transport.repository';
import { findUniformVariants } from '../uniforms/uniforms.repository';
import { asHttpError } from '../common/database-errors';
import { ENV } from '../config/config.module';
import { type Env } from '../config/env';
import { Database, type PersonTransaction } from '../database/database';
import { PAYMENT_PROVIDER, type PaymentProvider } from '../payments/provider';
import { type BasketItem, CheckoutRejected, planCheckout, type UniformVariant } from './checkout-plan';

// Checkout (ADR 0008, 0010):
//  1. One transaction as the parent: validate, create one order per billing
//     entity with its lines, reserve capacity, place the orders, record a
//     payment per order and an outbox event. Row-level security and the
//     database's own checks apply to every row written.
//  2. Outside the transaction (no locks held during a network call): ask the
//     payment provider for a hosted checkout per payment, then record its id.
// Nothing here confirms a payment; only the worker does, after a verified event.

interface CreatedOrder {
  orderId: string;
  orderNumber: string;
  billingEntityName: string;
  totalMinor: number;
  currency: string;
  paymentId: string;
  expiresAt: Date;
  groupId: string;
  description: string;
}

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async checkout(
    principal: Principal,
    idempotencyKey: string,
    items: BasketItem[],
  ): Promise<CheckoutResponse> {
    let created: { groupId: string; orders: CreatedOrder[] } | { existing: string };
    try {
      created = await this.database.withPerson(principal, async (tx) => {
        const existing = await tx.query<{ checkout_group_id: string }>(
          `SELECT checkout_group_id FROM commerce.customer_order
            WHERE payer_person_id = app.current_person_id() AND idempotency_key LIKE $1 LIMIT 1`,
          [`${idempotencyKey}:%`],
        );
        if (existing[0]) return { existing: existing[0].checkout_group_id };
        return this.createOrders(tx, principal, idempotencyKey, items);
      });
    } catch (error) {
      if (error instanceof CheckoutRejected) throw error;
      throw asHttpError(error);
    }

    if ('existing' in created) {
      // A repeated request (double click, retry): answer with what already exists.
      const view = await this.view(principal, created.existing);
      return {
        checkoutGroupId: created.existing,
        orders: (view?.orders ?? []).map((order) => ({
          orderId: order.orderId,
          orderNumber: order.orderNumber,
          billingEntityName: order.billingEntityName,
          totalMinor: order.totalMinor,
          currency: order.currency,
          paymentId: order.payment?.id ?? '',
          checkoutUrl: order.checkoutUrl,
        })),
      };
    }

    const orders: CheckoutResponse['orders'] = [];
    for (const order of created.orders) {
      orders.push({ ...order, checkoutUrl: await this.startCheckout(principal, order) });
    }
    return { checkoutGroupId: created.groupId, orders };
  }

  private async createOrders(
    tx: PersonTransaction,
    principal: Principal,
    idempotencyKey: string,
    items: BasketItem[],
  ): Promise<{ groupId: string; orders: CreatedOrder[] }> {
    const offeringsByStudent = new Map<string, Map<string, OfferingRow>>();
    const openSessionsByOffering = new Map<string, SessionRow[]>();

    for (const studentId of new Set(items.map((item) => item.studentId))) {
      const found = await findStudentWithSchools(tx, studentId);
      if (!found || found.schoolIds.length === 0) throw new CheckoutRejected(404, 'child not found');
      const [rights] = await tx.query<{ pay: boolean; book: boolean }>(
        `SELECT access.is_guardian_of($1, 'pay') AS pay, access.is_guardian_of($1, 'manage_bookings') AS book`,
        [studentId],
      );
      if (!rights?.pay || !rights.book) {
        throw new CheckoutRejected(403, 'you are not authorised to book and pay for this child');
      }
      const wanted = items.filter((item) => item.studentId === studentId).map((item) => item.offeringId);
      const offerings = await findBookableOfferings(tx, found.schoolIds, wanted);
      // A clear refusal before anything is written; the booking trigger checks each session again.
      const problems = await findEligibilityProblems(
        tx,
        studentId,
        offerings.map((offering) => ({ id: offering.id, firstDay: null })),
      );
      const refused = offerings.find((offering) => problems.has(offering.id));
      if (refused) {
        throw new CheckoutRejected(
          422,
          `${found.student.given_name} cannot take ${refused.name}: ${problems.get(refused.id)}`,
        );
      }
      // Trips need a guardian's permission first; the booking trigger checks it again (ADR 0023).
      const trips = offerings.filter((offering) => offering.kind === 'trip');
      const permitted = await findTripPermissions(
        tx,
        studentId,
        trips.map((trip) => trip.id),
      );
      const unpermitted = trips.find((trip) => !permitted.has(trip.id));
      if (unpermitted) {
        throw new CheckoutRejected(
          409,
          `${unpermitted.name} needs a guardian's permission for ${found.student.given_name} first`,
        );
      }
      offeringsByStudent.set(studentId, new Map(offerings.map((offering) => [offering.id, offering])));
      const missing = offerings.map((o) => o.id).filter((id) => !openSessionsByOffering.has(id));
      if (missing.length) {
        for (const session of await findOpenSessions(tx, missing)) {
          openSessionsByOffering.set(session.offering_id, [
            ...(openSessionsByOffering.get(session.offering_id) ?? []),
            session,
          ]);
        }
      }
    }

    const transportIds = [...offeringsByStudent.values()].flatMap((offerings) =>
      [...offerings.values()].filter((o) => o.kind === 'transport').map((o) => o.id),
    );
    const routesByOffering = await findRoutes(tx, [...new Set(transportIds)]);
    const uniformsByStudent = new Map<string, Map<string, UniformVariant>>();
    for (const studentId of new Set(items.filter((item) => item.variantId).map((item) => item.studentId))) {
      const found = await findStudentWithSchools(tx, studentId);
      const rows = found ? await findUniformVariants(tx, found.schoolIds) : [];
      uniformsByStudent.set(
        studentId,
        new Map(
          rows.map((row) => [
            row.variant_id,
            {
              offeringId: row.offering_id,
              offeringName: row.offering_name,
              schoolId: row.school_id,
              billingEntityId: row.billing_entity_id,
              billingEntityName: row.billing_entity_name,
              label: [row.size, row.colour].filter(Boolean).join(', ') || row.sku,
              priceVersionId: row.price_version_id,
              unitAmountMinor: Number(row.unit_amount_minor),
              currency: row.currency,
              vatRateBp: row.vat_rate_bp,
              free: row.free,
            },
          ]),
        ),
      );
    }
    const planned = planCheckout({
      items,
      offeringsByStudent,
      openSessionsByOffering,
      routesByOffering,
      uniformsByStudent,
    });
    const groupId = randomUUID();
    const expiresAt = new Date(Date.now() + this.env.CHECKOUT_TTL_MINUTES * 60_000);
    const [{ group_id: tenantGroupId } = { group_id: '' }] = await tx.query<{ group_id: string }>(
      'SELECT access.current_group_id() AS group_id',
    );
    const orders: CreatedOrder[] = [];

    for (const order of planned) {
      const orderId = randomUUID();
      const paymentId = randomUUID();
      const [row] = await tx.query<{ order_number: string }>(
        `INSERT INTO commerce.customer_order
           (id, group_id, billing_entity_id, payer_person_id, checkout_group_id, origin, currency, idempotency_key, created_by_person_id)
         VALUES ($1, $2, $3, $4, $5, 'family_portal', $6, $7, $4)
         RETURNING order_number`,
        [
          orderId,
          tenantGroupId,
          order.billingEntityId,
          principal.personId,
          groupId,
          order.currency,
          `${idempotencyKey}:${order.billingEntityId}`,
        ],
      );

      let lineNo = 0;
      for (const line of order.lines) {
        lineNo += 1;
        const lineId = randomUUID();
        await tx.query(
          `INSERT INTO commerce.order_line
             (id, group_id, order_id, billing_entity_id, line_no, school_id, offering_id, session_id, student_person_id,
              price_version_id, description, service_date, quantity, currency, unit_amount_minor, vat_rate_bp, line_total_minor)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            lineId,
            tenantGroupId,
            orderId,
            order.billingEntityId,
            lineNo,
            line.schoolId,
            line.offeringId,
            line.sessionId,
            line.studentId,
            line.priceVersionId,
            line.description,
            line.serviceDate,
            line.quantity,
            line.currency,
            line.unitAmountMinor,
            line.vatRateBp,
            line.unitAmountMinor * line.quantity,
          ],
        );
        if (line.stock) {
          // The variant row lock and its check hold the stock; not enough aborts the whole checkout.
          await tx.query(
            `INSERT INTO commerce.stock_reservation
               (group_id, school_id, variant_id, order_line_id, student_person_id, quantity, status, reserved_until,
                created_by_person_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'reserved', $7, app.current_person_id())`,
            [
              tenantGroupId,
              line.schoolId,
              line.stock.variantId,
              lineId,
              line.studentId,
              line.stock.quantity,
              expiresAt,
            ],
          );
        }
        for (const sessionId of line.bookingSessionIds) {
          // The database holds the seat (row lock + capacity check); a full session aborts the whole checkout.
          await tx.query(
            `INSERT INTO scheduling.booking
               (group_id, school_id, session_id, student_person_id, order_line_id, status, reserved_until, created_by_person_id,
                transport_stop_id)
             VALUES ($1, $2, $3, $4, $5, 'reserved', $6, app.current_person_id(), $7)`,
            [
              tenantGroupId,
              line.schoolId,
              sessionId,
              line.studentId,
              lineId,
              expiresAt,
              line.transportStopId,
            ],
          );
        }
      }

      await tx.query(
        `UPDATE commerce.customer_order SET status = 'pending_payment', total_minor = $2, placed_at = now(), expires_at = $3
          WHERE id = $1`,
        [orderId, order.totalMinor, expiresAt],
      );
      await tx.query(
        `INSERT INTO commerce.payment (id, group_id, order_id, billing_entity_id, provider, provider_mode, amount_minor, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          paymentId,
          tenantGroupId,
          orderId,
          order.billingEntityId,
          this.provider.name,
          this.provider.mode,
          order.totalMinor,
          order.currency,
        ],
      );
      await tx.query(
        `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'commerce.order', $2, 'commerce.order.placed', $3)`,
        [tenantGroupId, orderId, JSON.stringify({ order_id: orderId, payment_id: paymentId })],
      );

      orders.push({
        orderId,
        orderNumber: row?.order_number ?? '',
        billingEntityName: order.billingEntityName,
        totalMinor: order.totalMinor,
        currency: order.currency,
        paymentId,
        expiresAt,
        groupId,
        description: `Pythagoras order ${row?.order_number ?? ''}`,
      });
    }
    return { groupId, orders };
  }

  /** Asks the provider for a hosted checkout. A failure leaves the order reserved until it expires. */
  private async startCheckout(principal: Principal, order: CreatedOrder): Promise<string | null> {
    const returnTo = `${this.env.PORTAL_URL}/orders/${order.groupId}`;
    try {
      const checkout = await this.provider.createCheckout({
        paymentId: order.paymentId,
        orderId: order.orderId,
        groupId: order.groupId,
        amountMinor: order.totalMinor,
        currency: order.currency,
        description: order.description,
        successUrl: `${returnTo}?returned=1`,
        cancelUrl: `${returnTo}?cancelled=1`,
        expiresAt: order.expiresAt,
      });
      await this.database.withPerson(principal, (tx) =>
        tx.query(
          `UPDATE commerce.payment SET provider_checkout_id = $2, checkout_url = $3, status = 'pending' WHERE id = $1`,
          [order.paymentId, checkout.checkoutId, checkout.url],
        ),
      );
      return checkout.url;
    } catch (error) {
      this.logger.error(
        `checkout for payment ${order.paymentId} failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  /** The parent's view of one checkout group, straight from the database (never from the browser). */
  async view(principal: Principal, groupId: string): Promise<CheckoutGroupView | null> {
    return this.database.withPerson(principal, async (tx) => {
      const orders = await tx.query<{
        id: string;
        order_number: string;
        status: string;
        legal_name: string;
        total_minor: string;
        currency: string;
        expires_at: Date | null;
        paid_at: Date | null;
      }>(
        `SELECT o.id, o.order_number, o.status, le.legal_name, o.total_minor, o.currency, o.expires_at, o.paid_at
           FROM commerce.customer_order o JOIN org.legal_entity le ON le.id = o.billing_entity_id
          WHERE o.checkout_group_id = $1 ORDER BY o.order_number`,
        [groupId],
      );
      if (orders.length === 0) return null;
      const ids = orders.map((order) => order.id);
      const payments = await tx.query<{
        id: string;
        order_id: string;
        status: string;
        provider: string;
        provider_mode: string;
        checkout_url: string | null;
      }>(
        `SELECT DISTINCT ON (order_id) id, order_id, status, provider, provider_mode, checkout_url
           FROM commerce.payment WHERE order_id = ANY ($1::uuid[]) ORDER BY order_id, created_at DESC`,
        [ids],
      );
      const lines = await tx.query<{
        order_id: string;
        description: string;
        student_name: string | null;
        service_date: string | null;
        line_total_minor: string;
        status: string;
      }>(
        `SELECT l.order_id, l.description, p.given_name AS student_name,
                to_char(l.service_date, 'YYYY-MM-DD') AS service_date, l.line_total_minor, l.status
           FROM commerce.order_line l LEFT JOIN people.person p ON p.id = l.student_person_id
          WHERE l.order_id = ANY ($1::uuid[]) ORDER BY l.order_id, l.line_no`,
        [ids],
      );
      return {
        checkoutGroupId: groupId,
        orders: orders.map((order) => {
          const payment = payments.find((p) => p.order_id === order.id);
          return {
            orderId: order.id,
            orderNumber: order.order_number,
            status: order.status,
            billingEntityName: order.legal_name,
            totalMinor: Number(order.total_minor),
            currency: order.currency,
            expiresAt: order.expires_at?.toISOString() ?? null,
            paidAt: order.paid_at?.toISOString() ?? null,
            // Offered only while the order still holds its seats and the checkout is open.
            checkoutUrl:
              order.status === 'pending_payment' && payment?.status === 'pending'
                ? payment.checkout_url
                : null,
            payment: payment
              ? {
                  id: payment.id,
                  status: payment.status,
                  provider: payment.provider,
                  mode: payment.provider_mode,
                }
              : null,
            lines: lines
              .filter((line) => line.order_id === order.id)
              .map((line) => ({
                description: line.description,
                studentName: line.student_name,
                serviceDate: line.service_date,
                totalMinor: Number(line.line_total_minor),
                status: line.status,
              })),
          };
        }),
      };
    });
  }
}
