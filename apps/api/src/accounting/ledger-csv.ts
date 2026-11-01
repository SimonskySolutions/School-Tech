import { minorUnitDigits } from '@pythagoras/shared';

// The accounting export's layout (M7.4, docs/accounting-export.md): one line
// per ledger entry, comma-separated, quoted as RFC 4180 asks, UTF-8 without a
// byte-order mark, amounts with a full stop and the currency's decimals. It is
// the platform's own layout until the accountants confirm their software.

export interface LedgerEntry {
  entry_id: string;
  local_date: string;
  entry: string;
  payment_mode: string;
  order_number: string;
  school_code: string;
  school_name: string;
  service_code: string;
  description: string;
  service_date: string | null;
  currency: string;
  amount_minor: string;
  payment_provider: string | null;
  payment_reference: string | null;
  refund_id: string | null;
  credit_id: string | null;
}

export const COLUMNS = [
  'date',
  'entry',
  'mode',
  'order',
  'school_code',
  'school',
  'service',
  'description',
  'service_date',
  'currency',
  'amount',
  'payment_provider',
  'payment_reference',
  'refund_id',
  'credit_id',
  'entry_id',
] as const;

/** "60.00", "-15.00": minor units as a decimal with the currency's digits. */
export function amount(minor: string | number, currency: string): string {
  const value = BigInt(minor);
  const digits = minorUnitDigits(currency);
  const sign = value < 0n ? '-' : '';
  const absolute = (value < 0n ? -value : value).toString().padStart(digits + 1, '0');
  return digits === 0
    ? `${sign}${absolute}`
    : `${sign}${absolute.slice(0, -digits)}.${absolute.slice(-digits)}`;
}

/**
 * A text cell: quoted when it holds a comma, quote or line break, and kept
 * from being read as a formula by spreadsheets (a leading = + - @ tab or CR).
 */
export function cell(value: string | null): string {
  if (value === null) return '';
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function ledgerCsv(entries: readonly LedgerEntry[]): string {
  const lines = [COLUMNS.join(',')];
  for (const entry of entries) {
    lines.push(
      [
        entry.local_date,
        cell(entry.entry),
        cell(entry.payment_mode),
        cell(entry.order_number),
        cell(entry.school_code),
        cell(entry.school_name),
        cell(entry.service_code),
        cell(entry.description),
        entry.service_date ?? '',
        cell(entry.currency),
        amount(entry.amount_minor, entry.currency),
        cell(entry.payment_provider),
        cell(entry.payment_reference),
        entry.refund_id ?? '',
        entry.credit_id ?? '',
        entry.entry_id,
      ].join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
