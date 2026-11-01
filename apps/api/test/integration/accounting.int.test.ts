import { type AccountingCompanies, type AccountingSummary } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, MILA, offeringsOf, payAndWait, placeOrder, tokenFor } from './helpers';

// The accounting export (M7.4) against the real stack: Anna pays for a lunch
// at School A, billed by Testing Company; group finance sees the payment in
// the company's summary for today and in the CSV, marked "test" (the
// development provider is a test-mode provider), and nobody else may export.

const today = new Date().toISOString().slice(0, 10);
const tokens: Record<string, string> = {};

beforeAll(async () => {
  for (const user of ['finance', 'principal.a', 'ceo', 'anna.ivanova']) tokens[user] = await tokenFor(user);
});

describe('the accounting export', () => {
  it('lists each entry of a company’s ledger for group finance, with totals that match', async () => {
    const { lunch } = await offeringsOf(tokens['anna.ivanova']!, MILA);
    const free = lunch.sessions.filter((session) => !session.alreadyBooked && (session.available ?? 1) > 0);
    const placed = await placeOrder(tokens['anna.ivanova']!, [
      { studentId: MILA, offeringId: lunch.id, sessionIds: [free[0]!.id] },
    ]);
    await payAndWait(tokens['anna.ivanova']!, placed);
    const orderNumber = placed.orders[0]!.orderNumber;

    const companies = (await get<AccountingCompanies>('/accounting/companies', tokens['finance']!)).body
      .companies;
    const company = companies.find((entry) => entry.legalName === 'Testing Company')!;
    expect(company).toBeDefined();
    const query = new URLSearchParams({ companyId: company.id, from: today, to: today }).toString();

    const summary = (await get<AccountingSummary>(`/accounting/summary?${query}`, tokens['finance']!)).body;
    expect(summary.company.legalName).toBe('Testing Company');
    expect(summary.entries).toBeGreaterThanOrEqual(1);
    const payments = summary.totals.find((total) => total.mode === 'test' && total.kind === 'payment')!;
    expect(payments.amountMinor).toBeGreaterThan(0);

    const response = await fetch(`${API}/accounting/export?${query}`, {
      headers: { authorization: `Bearer ${tokens['finance']}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="ledger-[0-9a-f]{8}-/);
    const lines = (await response.text()).trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'date,entry,mode,order,school_code,school,service,description,service_date,currency,amount,payment_provider,payment_reference,refund_id,credit_id,entry_id',
    );
    const ours = lines.filter((line) => line.includes(`,${orderNumber},`));
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatch(new RegExp(`^${today},payment,test,${orderNumber},school-a,School A,lunch,`));
    expect(ours[0]).not.toMatch(/Anna|Mila|Ivanov/);
    // The file adds up to the summary's net, entry by entry.
    const net = lines
      .slice(1)
      .filter((line) => line.split(',')[2] === 'test')
      .reduce((sum, line) => sum + Math.round(Number(line.split(',').at(-6)) * 100), 0);
    expect(net).toBe(summary.net.find((entry) => entry.mode === 'test')!.amountMinor);
  });

  it('is for group finance only, and for a period of a year at most', async () => {
    const companies = (await get<AccountingCompanies>('/accounting/companies', tokens['finance']!)).body
      .companies;
    const query = new URLSearchParams({ companyId: companies[0]!.id, from: today, to: today }).toString();
    for (const user of ['principal.a', 'ceo', 'anna.ivanova']) {
      expect((await get(`/accounting/companies`, tokens[user]!)).status).toBe(403);
      expect((await get(`/accounting/export?${query}`, tokens[user]!)).status).toBe(403);
    }
    const tooLong = new URLSearchParams({
      companyId: companies[0]!.id,
      from: '2024-01-01',
      to: today,
    }).toString();
    expect((await get(`/accounting/summary?${tooLong}`, tokens['finance']!)).status).toBe(400);
    expect((await get('/accounting/summary?companyId=x', tokens['finance']!)).status).toBe(400);
  });
});
