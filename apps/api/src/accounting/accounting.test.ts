import { describe, expect, it } from 'vitest';
import { periodSchema, summarise } from './accounting.controller';
import { amount, cell, COLUMNS, type LedgerEntry, ledgerCsv } from './ledger-csv';

const entry = (overrides: Partial<LedgerEntry>): LedgerEntry => ({
  entry_id: '01a19900-0000-7000-8000-000000000001',
  local_date: '2026-11-02',
  entry: 'payment',
  payment_mode: 'live',
  order_number: 'PY-00001234',
  school_code: 'school-a',
  school_name: 'School A',
  service_code: 'lunch',
  description: 'Lunch at School A, Monday',
  service_date: '2026-11-02',
  currency: 'EUR',
  amount_minor: '540',
  payment_provider: 'stripe',
  payment_reference: 'pi_123',
  refund_id: null,
  credit_id: null,
  ...overrides,
});

describe('the ledger CSV', () => {
  it('writes amounts with the currency’s decimals', () => {
    expect(amount('6000', 'EUR')).toBe('60.00');
    expect(amount('-1500', 'EUR')).toBe('-15.00');
    expect(amount('5', 'EUR')).toBe('0.05');
    expect(amount('-5', 'EUR')).toBe('-0.05');
    expect(amount('1200', 'JPY')).toBe('1200');
  });

  it('quotes what needs quoting and never lets a cell become a formula', () => {
    expect(cell('School A')).toBe('School A');
    expect(cell('Lunch, Monday')).toBe('"Lunch, Monday"');
    expect(cell('The "big" fair')).toBe('"The ""big"" fair"');
    expect(cell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(cell('+359')).toBe("'+359");
    expect(cell(null)).toBe('');
  });

  it('has a header and one line per entry, in the documented columns', () => {
    const csv = ledgerCsv([entry({}), entry({ entry: 'refund', amount_minor: '-540', refund_id: 'r1' })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe(COLUMNS.join(','));
    expect(lines[1]).toBe(
      '2026-11-02,payment,live,PY-00001234,school-a,School A,lunch,"Lunch at School A, Monday",2026-11-02,EUR,5.40,stripe,pi_123,,,01a19900-0000-7000-8000-000000000001',
    );
    expect(lines[2]).toContain(',EUR,-5.40,');
    expect(lines).toHaveLength(4);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('the accounting summary', () => {
  it('adds up per currency, mode and kind, and nets per currency and mode', () => {
    const summary = summarise([
      entry({}),
      entry({ amount_minor: '1000' }),
      entry({ entry: 'refund', amount_minor: '-300' }),
      entry({ payment_mode: 'test', amount_minor: '999' }),
    ]);
    expect(summary.entries).toBe(4);
    expect(summary.totals).toContainEqual({
      currency: 'EUR',
      mode: 'live',
      kind: 'payment',
      amountMinor: 1540,
      entries: 2,
    });
    expect(summary.net).toEqual([
      { currency: 'EUR', mode: 'live', amountMinor: 1240 },
      { currency: 'EUR', mode: 'test', amountMinor: 999 },
    ]);
  });

  it('needs a company and a period', () => {
    expect(
      periodSchema.safeParse({
        companyId: '01a19900-0000-7000-8000-000000000001',
        from: '2026-10-01',
        to: '2026-10-31',
      }).success,
    ).toBe(true);
    expect(periodSchema.safeParse({ companyId: 'x', from: '2026-10-01', to: '2026-10-31' }).success).toBe(
      false,
    );
    expect(
      periodSchema.safeParse({ companyId: '01a19900-0000-7000-8000-000000000001', from: 'October' }).success,
    ).toBe(false);
  });
});
