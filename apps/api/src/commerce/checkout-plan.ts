import { sumMoney } from '@pythagoras/shared';
import { isPackage, type OfferingRow, pickSessions, type SessionRow } from '../catalog/catalog.repository';

// Turns a basket into orders, before anything is written. Pure, so the rules
// are unit-tested: what may be bought for which child, how lines are formed,
// and the split into one order per billing entity (ADR 0008).

export interface BasketItem {
  studentId: string;
  offeringId: string;
  sessionIds?: string[];
}

export interface PlannedLine {
  studentId: string;
  offeringId: string;
  schoolId: string;
  priceVersionId: string;
  description: string;
  serviceDate: string | null;
  sessionId: string | null;
  quantity: 1;
  unitAmountMinor: number;
  vatRateBp: number;
  currency: string;
  /** Sessions this line books (one for a lunch day, all of them for an activity). */
  bookingSessionIds: string[];
}

export interface PlannedOrder {
  billingEntityId: string;
  billingEntityName: string;
  currency: string;
  totalMinor: number;
  lines: PlannedLine[];
}

export class CheckoutRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

export interface PlanInput {
  items: readonly BasketItem[];
  /** Bookable offerings per student (already limited to the student's schools). */
  offeringsByStudent: ReadonlyMap<string, ReadonlyMap<string, OfferingRow>>;
  openSessionsByOffering: ReadonlyMap<string, readonly SessionRow[]>;
}

export function planCheckout({
  items,
  offeringsByStudent,
  openSessionsByOffering,
}: PlanInput): PlannedOrder[] {
  if (items.length === 0) throw new CheckoutRejected(422, 'the basket is empty');
  const lines: (PlannedLine & { billingEntityId: string; billingEntityName: string })[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const offering = offeringsByStudent.get(item.studentId)?.get(item.offeringId);
    if (!offering) throw new CheckoutRejected(422, 'an item is not available for this child');
    const open = openSessionsByOffering.get(offering.id) ?? [];
    const base = {
      studentId: item.studentId,
      offeringId: offering.id,
      schoolId: offering.school_id,
      priceVersionId: offering.price_version_id,
      quantity: 1 as const,
      unitAmountMinor: Number(offering.unit_amount_minor),
      vatRateBp: offering.vat_rate_bp,
      currency: offering.currency,
      billingEntityId: offering.billing_entity_id,
      billingEntityName: offering.billing_entity_name,
    };

    if (isPackage(offering.price_unit)) {
      // A package of lessons: one line, no booking; slots are booked from the package once it is paid.
      const key = `package:${offering.id}`;
      claim(seen, item.studentId, key);
      lines.push({
        ...base,
        description: `${offering.name} (${offering.package_size ?? 1} lessons)`,
        serviceDate: null,
        sessionId: null,
        bookingSessionIds: [],
      });
    } else if (pickSessions(offering.kind, offering.price_unit)) {
      const ids = [...new Set(item.sessionIds ?? [])];
      if (ids.length === 0) throw new CheckoutRejected(422, `choose at least one day for ${offering.name}`);
      for (const id of ids) {
        const session = open.find((candidate) => candidate.id === id);
        if (!session)
          throw new CheckoutRejected(409, `a chosen day for ${offering.name} is no longer open for booking`);
        claim(seen, item.studentId, id);
        lines.push({
          ...base,
          description: `${offering.name}, ${session.service_date ?? session.starts_at?.toISOString().slice(0, 10)}`,
          serviceDate: session.service_date,
          sessionId: session.id,
          bookingSessionIds: [session.id],
        });
      }
    } else {
      if (open.length === 0)
        throw new CheckoutRejected(409, `${offering.name} has no sessions open for booking`);
      for (const session of open) claim(seen, item.studentId, session.id);
      lines.push({
        ...base,
        description: `${offering.name} (${open.length} sessions)`,
        serviceDate: null,
        sessionId: null,
        bookingSessionIds: open.map((session) => session.id),
      });
    }
  }

  const orders = new Map<string, PlannedOrder>();
  for (const { billingEntityId, billingEntityName, ...line } of lines) {
    const order = orders.get(billingEntityId) ?? {
      billingEntityId,
      billingEntityName,
      currency: line.currency,
      totalMinor: 0,
      lines: [],
    };
    if (order.currency !== line.currency) {
      throw new CheckoutRejected(422, 'items billed by one company must share a currency');
    }
    order.lines.push(line);
    orders.set(billingEntityId, order);
  }
  for (const order of orders.values()) {
    order.totalMinor = sumMoney(order.lines.map((line) => line.unitAmountMinor * line.quantity));
  }
  return [...orders.values()];
}

function claim(seen: Set<string>, studentId: string, sessionId: string) {
  const key = `${studentId}:${sessionId}`;
  if (seen.has(key)) throw new CheckoutRejected(422, 'the same session is in the basket twice for one child');
  seen.add(key);
}
