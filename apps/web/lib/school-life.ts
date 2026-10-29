// Display rules for the School Life pages, as plain functions so they can be
// tested without a browser. Times are shown in the school's own time zone.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The date range a page asks for: a valid "from" date and 1-31 days, or the API's defaults. */
export function readRange(params: Record<string, string | string[] | undefined>): {
  from: string | null;
  days: number | null;
} {
  const from = typeof params.from === 'string' && DAY.test(params.from) ? params.from : null;
  const days = typeof params.days === 'string' ? Number(params.days) : NaN;
  return { from, days: Number.isInteger(days) && days >= 1 && days <= 31 ? days : null };
}

/** The same range moved by its own length, for "earlier" and "later" links. */
export function shiftRange(from: string, days: number, direction: 1 | -1): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + direction * days);
  return `?from=${date.toISOString().slice(0, 10)}&days=${days}`;
}

export function formatDay(date: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

/** "Wed 4 Nov, 14:00–15:00" in the school's time zone. */
export function formatSessionTime(startsAt: string, endsAt: string | null, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone,
  }).format(new Date(startsAt));
  const time = (value: string) =>
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone }).format(
      new Date(value),
    );
  return `${day}, ${time(startsAt)}${endsAt ? `–${time(endsAt)}` : ''}`;
}

const SEVERITY: Record<string, string> = {
  life_threatening: 'Life-threatening',
  severe: 'Severe',
  moderate: 'Moderate',
  information: 'For information',
};

const KIND: Record<string, string> = {
  allergy: 'Allergy',
  intolerance: 'Intolerance',
  medical_diet: 'Medical diet',
  religious_or_cultural: 'Religious or cultural',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  other: 'Other',
};

export function dietaryLabel(kind: string, severity: string | null): string {
  const label = KIND[kind] ?? kind;
  return severity ? `${label} (${SEVERITY[severity] ?? severity})` : label;
}

/** A life-threatening or severe need is shown as an alert, never as plain text. */
export const isUrgent = (severity: string | null) => severity === 'life_threatening' || severity === 'severe';

export function attendanceLabel(status: string): string {
  if (status === 'attended') return 'Attended';
  if (status === 'absent') return 'Absent';
  return 'Booked';
}
