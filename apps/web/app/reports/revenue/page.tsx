import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchRevenueReport } from '../../../lib/api-client';
import { money, readPeriod } from '../../../lib/reports';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const cell = { textAlign: 'right' as const, padding: '0.25rem 0.75rem' };
const head = { ...cell, borderBottom: '1px solid #999' };

/**
 * Revenue per school for a period and today's open balances. Test-mode money
 * (the development provider) has its own columns and never counts as revenue.
 */
export default async function RevenuePage({ searchParams }: { searchParams: SearchParams }) {
  const { period, invalid } = readPeriod(await searchParams);
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchRevenueReport(config.API_INTERNAL_URL, session.accessToken, period);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Revenue and balances</h1>
        <p data-testid="not-permitted">Reports are for management and finance staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const report = result.value;
  const hasTestMoney = report.schools.some(
    (row) => row.test.receivedMinor !== 0 || row.test.netMinor !== 0 || row.creditOwed.testMinor !== 0,
  );

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Revenue and balances</h1>
      {invalid ? (
        <p role="alert" data-testid="period-invalid">
          That period could not be used (both dates, from before to, at most a year). Showing this month.
        </p>
      ) : null}
      <form method="get" style={{ display: 'flex', gap: '0.75rem', alignItems: 'end', flexWrap: 'wrap' }}>
        <label>
          From <input type="date" name="from" defaultValue={report.from} required />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={report.to} required />
        </label>
        <button type="submit">Show</button>
      </form>
      <p data-testid="period">{`Money received from ${report.from} to ${report.to} (school-local dates). Balances are as of now.`}</p>
      {hasTestMoney ? (
        <p
          data-testid="test-money-note"
          style={{ background: '#fff4ce', padding: '0.5rem 0.75rem', borderRadius: 4 }}
        >
          Test payments come from the development payment provider. No money moved; they are not revenue.
        </p>
      ) : null}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse' }} data-testid="revenue-table">
          <thead>
            <tr>
              <th style={{ ...head, textAlign: 'left' }}>School</th>
              <th style={head}>Received</th>
              <th style={head}>Paid by credit</th>
              <th style={head}>Refunded</th>
              <th style={head}>Credited</th>
              <th style={head}>Net revenue</th>
              <th style={head}>Test payments (not revenue)</th>
              <th style={head}>Unpaid invoices</th>
              <th style={head}>Of which overdue</th>
              <th style={head}>Checkouts in progress</th>
              <th style={head}>Credit owed to families</th>
            </tr>
          </thead>
          <tbody>
            {report.schools.map((row) => (
              <tr key={`${row.school.id}-${row.currency}`} data-testid={`revenue-${row.school.name}`}>
                <td style={{ ...cell, textAlign: 'left' }}>{row.school.name}</td>
                <td style={cell}>{money(row.live.receivedMinor, row.currency)}</td>
                <td style={cell}>{money(row.live.paidByCreditMinor, row.currency)}</td>
                <td style={cell}>{money(row.live.refundedMinor, row.currency)}</td>
                <td style={cell}>{money(row.live.creditedMinor, row.currency)}</td>
                <td style={{ ...cell, fontWeight: 600 }} data-testid="live-net">
                  {money(row.live.netMinor, row.currency)}
                </td>
                <td style={cell} data-testid="test-net">
                  {money(row.test.netMinor, row.currency)}
                </td>
                <td style={cell}>
                  {row.openInvoices
                    ? `${money(row.outstandingMinor, row.currency)} (${row.openInvoices})`
                    : money(0, row.currency)}
                </td>
                <td style={cell}>{money(row.overdueMinor, row.currency)}</td>
                <td style={cell}>{money(row.checkoutInProgressMinor, row.currency)}</td>
                <td style={cell}>
                  {money(row.creditOwed.liveMinor, row.currency)}
                  {row.creditOwed.testMinor
                    ? ` (+ ${money(row.creditOwed.testMinor, row.currency)} test)`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            {report.totals.map((total) => (
              <tr key={total.currency} data-testid={`total-${total.currency}`}>
                <th
                  style={{ ...cell, textAlign: 'left', borderTop: '1px solid #999' }}
                >{`All schools (${total.currency})`}</th>
                <td style={{ ...cell, borderTop: '1px solid #999' }}>
                  {money(total.live.receivedMinor, total.currency)}
                </td>
                <td style={{ ...cell, borderTop: '1px solid #999' }}>
                  {money(total.live.paidByCreditMinor, total.currency)}
                </td>
                <td style={{ ...cell, borderTop: '1px solid #999' }}>
                  {money(total.live.refundedMinor, total.currency)}
                </td>
                <td style={{ ...cell, borderTop: '1px solid #999' }}>
                  {money(total.live.creditedMinor, total.currency)}
                </td>
                <td style={{ ...cell, borderTop: '1px solid #999', fontWeight: 600 }}>
                  {money(total.live.netMinor, total.currency)}
                </td>
                <td style={{ ...cell, borderTop: '1px solid #999' }}>
                  {money(total.test.netMinor, total.currency)}
                </td>
                <td colSpan={4} style={{ borderTop: '1px solid #999' }} />
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
    </main>
  );
}
