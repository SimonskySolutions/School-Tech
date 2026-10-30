// Session calendars for a new school's offerings, as calendar dates
// (YYYY-MM-DD, no time zone). Pure, so the rules are unit-tested; the database
// turns dates into instants in the school's own time zone.

export const MAX_CALENDAR_DAYS = 400;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parse(date: string): Date {
  if (!DAY.test(date)) throw new RangeError(`not a date: ${date}`);
  const value = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) {
    throw new RangeError(`not a date: ${date}`);
  }
  return value;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = parse(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function* days(from: string, to: string): Generator<string> {
  const start = parse(from);
  const end = parse(to);
  if (start > end) throw new RangeError('the first day is after the last');
  if ((end.getTime() - start.getTime()) / 86_400_000 >= MAX_CALENDAR_DAYS) {
    throw new RangeError(`at most ${MAX_CALENDAR_DAYS} days at a time`);
  }
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    yield day.toISOString().slice(0, 10);
  }
}

/** Monday to Friday between two dates (inclusive), without the closed days. */
export function schoolDays(from: string, to: string, closed: readonly string[] = []): string[] {
  const shut = new Set(closed.map((date) => parse(date).toISOString().slice(0, 10)));
  return [...days(from, to)].filter((date) => isoWeekday(date) <= 5 && !shut.has(date));
}

/** One day a week between two dates (inclusive), without the closed days. */
export function weeklyDays(
  from: string,
  to: string,
  weekday: number,
  closed: readonly string[] = [],
): string[] {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new RangeError('weekday must be 1-7');
  const shut = new Set(closed.map((date) => parse(date).toISOString().slice(0, 10)));
  return [...days(from, to)].filter((date) => isoWeekday(date) === weekday && !shut.has(date));
}

export interface ReadinessFacts {
  status: string;
  publishedOfferings: number;
  offeringsWithoutSessions: string[];
  principals: number;
}

/** What still stops a draft school from going live; empty when it is ready. */
export function missingForActivation(facts: ReadinessFacts): string[] {
  const missing: string[] = [];
  if (facts.status !== 'draft') missing.push(`the school is already ${facts.status}`);
  if (facts.publishedOfferings === 0) missing.push('at least one published offering with a price');
  for (const name of facts.offeringsWithoutSessions) missing.push(`sessions for ${name}`);
  if (facts.principals === 0) missing.push('a principal');
  return missing;
}
