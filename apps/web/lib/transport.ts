import { type Form, FormProblem, text } from './admin';

// The transport forms (M4.5, ADR 0024), tested without a browser. The API and
// the database check everything again.

export const TRANSPORT_NOTICES: Record<string, string> = {
  route: 'Route set up. Add its stops in order.',
  stop: 'Stop added.',
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Weekdays come as several "weekday" checkboxes. */
export type MultiForm = Form & { getAll(name: string): FormDataEntryValue[] };

export function routeBody(form: MultiForm) {
  const weekdays = [
    ...new Set(
      form
        .getAll('weekday')
        .map((value) => Number(value))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
    ),
  ].sort();
  if (weekdays.length === 0) throw new FormProblem('choose the days the bus runs');
  const vehicle = text(form, 'vehicle');
  return { offeringId: text(form, 'offering_id'), weekdays, ...(vehicle ? { vehicle } : {}) };
}

export function stopBody(form: Form) {
  const name = text(form, 'name');
  const pickupTime = text(form, 'pickup_time');
  const dropoffTime = text(form, 'dropoff_time');
  if (!name || name.length > 120) throw new FormProblem('give the stop a name');
  if (!CLOCK.test(pickupTime)) throw new FormProblem('the pick-up time is like 07:30');
  if (dropoffTime && !CLOCK.test(dropoffTime)) throw new FormProblem('the time back is like 16:30');
  return { name, pickupTime, ...(dropoffTime ? { dropoffTime } : {}) };
}

/** "16 Nov 2026 to 12 Feb 2027": a term's first and last day, in the school's time zone. */
export function termDates(startsAt: string, endsAt: string | null, timeZone: string): string {
  const day = (instant: number) =>
    new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(
      instant,
    );
  const first = day(Date.parse(startsAt));
  // The term ends at midnight after its last day.
  return endsAt ? `${first} to ${day(Date.parse(endsAt) - 1)}` : `from ${first}`;
}
