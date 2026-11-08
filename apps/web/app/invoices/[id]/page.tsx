import { formatMoney } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchInvoice } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

/** One invoice, ready to print. */
export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchInvoice(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Invoice</h1>
        <p data-testid="not-permitted">This invoice is not yours to see.</p>
        <p>
          <Link href="/invoices">Invoices</Link>
        </p>
      </main>
    );
  }
  const invoice = result.value;
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/invoices">Invoices</Link>
      </p>
      <h1>{`Invoice ${invoice.number}`}</h1>
      <section aria-label="Invoice" data-testid="invoice">
        <dl className="facts">
          <div>
            <dt>Date</dt>
            <dd>{invoice.issuedOn}</dd>
          </div>
          <div>
            <dt>Order</dt>
            <dd>{invoice.orderNumber}</dd>
          </div>
          <div>
            <dt>Billed to</dt>
            <dd>{invoice.billedTo}</dd>
          </div>
          <div>
            <dt>From</dt>
            <dd>{invoice.company}</dd>
          </div>
          <div>
            <dt>Company number</dt>
            <dd>{invoice.registrationNumber}</dd>
          </div>
          {invoice.vatNumber ? (
            <div>
              <dt>VAT number</dt>
              <dd>{invoice.vatNumber}</dd>
            </div>
          ) : null}
        </dl>
        {invoice.address ? <p>{invoice.address}</p> : null}
        <table>
          <thead>
            <tr>
              <th>What for</th>
              <th className="number">Quantity</th>
              <th className="number">Price</th>
              <th className="number">VAT</th>
              <th className="number">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index}>
                <td>{line.description}</td>
                <td className="number">{line.quantity}</td>
                <td className="number">{money(line.unitMinor)}</td>
                <td className="number">{`${line.vatRateBp / 100}%`}</td>
                <td className="number">{money(line.totalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          <strong>{`Total ${money(invoice.totalMinor)}`}</strong>
        </p>
      </section>
    </main>
  );
}
