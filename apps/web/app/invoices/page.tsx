import { formatMoney } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchMyInvoices } from '../../lib/api-client';
import { currentSession, runtime } from '../../lib/server';
import { DevelopmentBanner } from '../development-banner';

export const dynamic = 'force-dynamic';

/** A family's invoices, one for each paid order. */
export default async function InvoicesPage() {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchMyInvoices(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  const invoices = result.kind === 'ok' ? result.value.invoices : [];
  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Invoices</h1>
      <section aria-label="Invoices" data-testid="invoices">
        {invoices.length === 0 ? <p>No invoices yet. Each paid order gets one.</p> : null}
        {invoices.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Number</th>
                <th>Date</th>
                <th>Company</th>
                <th className="number">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td>
                    <Link href={`/invoices/${invoice.id}`}>{invoice.number}</Link>
                  </td>
                  <td>{invoice.issuedOn}</td>
                  <td>{invoice.company}</td>
                  <td className="number">{formatMoney(invoice.totalMinor, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
