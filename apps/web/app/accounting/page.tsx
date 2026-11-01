import { formatMoney } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ENTRY_LABELS, readPeriod } from '../../lib/accounting';
import { fetchAccountingCompanies, fetchAccountingSummary } from '../../lib/api-client';
import { currentSession, runtime } from '../../lib/server';
import { DevelopmentBanner } from '../development-banner';

export const dynamic = 'force-dynamic';

const cell = { border: '1px solid #ccc', padding: '0.25rem 0.5rem', textAlign: 'left' } as const;

/** A company's ledger for a period, for the accountants (M7.4). Group finance only. */
export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const companies = await fetchAccountingCompanies(config.API_INTERNAL_URL, session.accessToken);
  if (companies.kind === 'signed-out') redirect('/auth/sign-in');
  if (companies.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Accounting export</h1>
        <p data-testid="not-permitted">This page is for group finance.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const period = readPeriod(query, companies.value.companies, new Date().toISOString().slice(0, 10));
  const summary = period
    ? await fetchAccountingSummary(config.API_INTERNAL_URL, session.accessToken, period)
    : null;
  const view = summary?.kind === 'ok' ? summary.value : null;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Accounting export</h1>
      <p data-testid="not-an-import-format">
        {
          "This is the platform's own layout, described in docs/accounting-export.md. It is not yet an import format for the accountants' software: that is set once they confirm which software and format they use. Book only entries marked live; test entries come from test payments and are never real money."
        }
      </p>
      <form
        method="get"
        action="/accounting"
        style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label>
          Company{' '}
          <select name="companyId" defaultValue={period?.companyId}>
            {companies.value.companies.map((company) => (
              <option key={company.id} value={company.id}>
                {`${company.legalName} (${company.registrationNumber})`}
              </option>
            ))}
          </select>
        </label>
        <label>
          From <input type="date" name="from" defaultValue={period?.from} required />
        </label>
        <label>
          To <input type="date" name="to" defaultValue={period?.to} required />
        </label>
        <button type="submit">Show</button>
      </form>
      {summary && summary.kind !== 'ok' ? <p role="alert">The period is one day to a year.</p> : null}
      {view && period ? (
        <section aria-labelledby="summary" data-testid="summary">
          <h2 id="summary">{`${view.company.legalName}, ${view.from} to ${view.to}: ${view.entries} entries`}</h2>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={cell}>Mode</th>
                <th style={cell}>Entries</th>
                <th style={cell}>Count</th>
                <th style={cell}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {view.totals.map((total) => (
                <tr key={`${total.currency}-${total.mode}-${total.kind}`}>
                  <td style={cell}>{total.mode}</td>
                  <td style={cell}>{ENTRY_LABELS[total.kind] ?? total.kind}</td>
                  <td style={cell}>{total.entries}</td>
                  <td style={cell}>{formatMoney(total.amountMinor, total.currency)}</td>
                </tr>
              ))}
              {view.net.map((net) => (
                <tr key={`${net.currency}-${net.mode}`} data-testid={`net-${net.mode}`}>
                  <td style={cell}>{net.mode}</td>
                  <td style={cell}>
                    <strong>Net</strong>
                  </td>
                  <td style={cell} />
                  <td style={cell}>
                    <strong>{formatMoney(net.amountMinor, net.currency)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <a href={`/accounting/export?${new URLSearchParams(period)}`} data-testid="download">
              Download the entries (CSV)
            </a>
          </p>
        </section>
      ) : null}
    </main>
  );
}
