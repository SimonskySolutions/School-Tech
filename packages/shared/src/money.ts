// Money is an integer number of minor units (cents) plus an ISO 4217 currency,
// exactly as stored in the database (ADR 0007). Floating point is used only to
// hand a value to Intl for display, never for arithmetic or storage.

export const DEFAULT_CURRENCY = 'EUR';
export const DEFAULT_LOCALE = 'bg-BG';

const CURRENCY_CODE = /^[A-Z]{3}$/;

export function minorUnitDigits(currency: string): number {
  if (!CURRENCY_CODE.test(currency)) {
    throw new RangeError(`not an ISO 4217 currency code: ${currency}`);
  }
  return (
    new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function assertMinorUnits(amountMinor: number): void {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amount must be a safe integer number of minor units, got ${amountMinor}`);
  }
}

/** Formats minor units for display, e.g. formatMoney(450) === '4,50 €' in Bulgarian. */
export function formatMoney(
  amountMinor: number,
  currency = DEFAULT_CURRENCY,
  locale = DEFAULT_LOCALE,
): string {
  assertMinorUnits(amountMinor);
  const digits = minorUnitDigits(currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amountMinor / 10 ** digits);
}

/**
 * Parses a non-negative decimal amount typed by a person ("4.50", "4,5", "12")
 * into minor units without floating-point arithmetic. Rejects anything with
 * more decimals than the currency has, thousands separators, or a sign.
 */
export function parseMoney(input: string, currency = DEFAULT_CURRENCY): number {
  const digits = minorUnitDigits(currency);
  const match = /^(\d{1,12})(?:[.,](\d+))?$/.exec(input.trim());
  if (!match) {
    throw new RangeError(`not a valid amount: "${input}"`);
  }
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > digits) {
    throw new RangeError(`"${input}" has more than ${digits} decimal places for ${currency}`);
  }
  const amount = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  assertMinorUnits(amount);
  return amount;
}

/** Sums minor-unit amounts, refusing results that would lose integer precision. */
export function sumMoney(amountsMinor: readonly number[]): number {
  let total = 0;
  for (const amount of amountsMinor) {
    assertMinorUnits(amount);
    total += amount;
    assertMinorUnits(total);
  }
  return total;
}
