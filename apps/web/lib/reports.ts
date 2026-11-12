import { formatMoney } from '@pythagoras/shared';

// The revenue page's rules, as plain functions so they can be tested.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

/**
 * The period asked for in the address, or null for the API's default (this
 * month). "invalid" says the address held a period that cannot be used.
 */
export function readPeriod(params: Record<string, string | string[] | undefined>): {
  period: { from: string; to: string } | null;
  invalid: boolean;
} {
  const from = params.from;
  const to = params.to;
  if (from === undefined && to === undefined) return { period: null, invalid: false };
  if (typeof from !== 'string' || typeof to !== 'string' || !DAY.test(from) || !DAY.test(to)) {
    return { period: null, invalid: true };
  }
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || (end - start) / 86_400_000 >= MAX_DAYS) {
    return { period: null, invalid: true };
  }
  return { period: { from, to }, invalid: false };
}

/** Money for a table cell; an empty dash for nothing, so real amounts stand out. */
export function money(amountMinor: number, currency: string): string {
  return amountMinor === 0 ? '–' : formatMoney(amountMinor, currency);
}
