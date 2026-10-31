import { type BookableOffering, type CheckoutGroupView, type CheckoutRequestBody } from '@pythagoras/shared';

// The booking form and the order page, as plain functions so they can be
// tested without a browser. Prices and totals always come from the API; the
// form only says which child, which offering and which days.

/**
 * Form values: "lunch" = student|offering|session; "activity", "package" (lessons) and "trip" =
 * student|offering; "transport" = student|offering|stop (the seat and the child's stop);
 * "uniform" = student|offering|variant|quantity.
 */
export function basketFromForm(
  entries: Iterable<[string, FormDataEntryValue]>,
): CheckoutRequestBody['items'] {
  const lunch = new Map<string, { studentId: string; offeringId: string; sessionIds: string[] }>();
  const activities = new Map<string, { studentId: string; offeringId: string; stopId?: string }>();
  const uniforms = new Map<
    string,
    { studentId: string; offeringId: string; variantId: string; quantity: number }
  >();
  for (const [name, raw] of entries) {
    if (typeof raw !== 'string') continue;
    const parts = raw.split('|');
    if (name === 'lunch' && parts.length === 3) {
      const [studentId, offeringId, sessionId] = parts as [string, string, string];
      const key = `${studentId}|${offeringId}`;
      const item = lunch.get(key) ?? { studentId, offeringId, sessionIds: [] };
      if (!item.sessionIds.includes(sessionId)) item.sessionIds.push(sessionId);
      lunch.set(key, item);
    } else if (
      (name === 'activity' || name === 'package' || name === 'trip' || name === 'fee') &&
      parts.length === 2
    ) {
      const [studentId, offeringId] = parts as [string, string];
      activities.set(raw, { studentId, offeringId });
    } else if (name === 'transport' && parts.length === 3) {
      const [studentId, offeringId, stopId] = parts as [string, string, string];
      activities.set(`${studentId}|${offeringId}`, { studentId, offeringId, stopId });
    } else if (name === 'uniform' && parts.length === 4) {
      const [studentId, offeringId, variantId, count] = parts as [string, string, string, string];
      const quantity = Number(count);
      if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 5) {
        uniforms.set(`${studentId}|${variantId}`, { studentId, offeringId, variantId, quantity });
      }
    }
  }
  return [...lunch.values(), ...activities.values(), ...uniforms.values()];
}

export const CHECKOUT_ERRORS: Record<string, string> = {
  empty: 'Choose at least one day of lunch or a club first.',
  unavailable: 'Some of the places you chose were just taken or are no longer open. Please choose again.',
  invalid: 'That selection could not be booked. Please choose again.',
  forbidden: 'You cannot book for this child. Please contact the school office.',
  failed: 'The booking could not be completed. Nothing was charged; please try again.',
};

/** Maps an API refusal of POST /checkout to one of CHECKOUT_ERRORS. */
export function checkoutError(status: number): keyof typeof CHECKOUT_ERRORS {
  if (status === 409) return 'unavailable';
  if (status === 403 || status === 404) return 'forbidden';
  if (status === 400 || status === 422) return 'invalid';
  return 'failed';
}

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/** "Fri 30 Oct" for a calendar date ("2026-10-30"); dates carry no time zone. */
export function formatServiceDate(date: string): string {
  return dateFormat.format(new Date(`${date}T00:00:00Z`));
}

export function activitySummary(offering: BookableOffering): string {
  const open = offering.sessions.filter((session) => !session.alreadyBooked);
  const where = offering.sessions.find((session) => session.location)?.location;
  return [`${open.length} ${open.length === 1 ? 'meeting' : 'meetings'}`, where].filter(Boolean).join(', ');
}

export type Order = CheckoutGroupView['orders'][number];

/** What the parent is told about one order. The page never decides payment itself. */
export function orderStatus(order: Order): { label: string; detail: string; settled: boolean } {
  switch (order.status) {
    case 'paid':
      return order.lines.some((line) => line.status === 'cancelled')
        ? {
            label: 'Paid',
            detail:
              'Payment confirmed. Some items are not booked (cancelled by the school, or full before the payment arrived); their amount is kept as credit for your next booking.',
            settled: true,
          }
        : { label: 'Paid', detail: 'Payment confirmed. Your places are booked.', settled: true };
    case 'cancelled':
      return {
        label: 'Payment failed',
        detail: 'Nothing was charged and the places were released. You can book again.',
        settled: true,
      };
    case 'expired':
      return {
        label: 'Not paid in time',
        detail: 'The places were released. If money was taken, it is confirmed here or credited to you.',
        settled: true,
      };
    default:
      return {
        label: 'Awaiting payment',
        detail: 'Your places are held while you pay.',
        settled: false,
      };
  }
}

export function lineStatus(status: string): string {
  if (status === 'confirmed') return 'Booked';
  if (status === 'cancelled') return 'Not booked';
  return 'Held';
}

export function minutesLeft(expiresAt: string | null, now = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000));
}
