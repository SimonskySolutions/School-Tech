import Link from 'next/link';
import { formatMoney } from '@pythagoras/shared';
import { notFound, redirect } from 'next/navigation';
import { fetchCheckoutGroup } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';
import { formatServiceDate, lineStatus, minutesLeft, type Order, orderStatus } from '../../../lib/services';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ group: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The parent's order, read from the API on every load. Coming back from the
 * payment page proves nothing: an order shows as paid only after the worker
 * has confirmed the provider's signed event (ADR 0010).
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { group } = await params;
  const query = await searchParams;
  if (!UUID.test(group)) notFound();
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchCheckoutGroup(config.API_INTERNAL_URL, session.accessToken, group);
  if (result.kind === 'not-found') notFound();
  if (result.kind !== 'ok') redirect('/');

  const orders = result.value.orders;
  const returned = Boolean(query.returned);
  const waiting = orders.some((order) => !orderStatus(order).settled);

  return (
    <main>
      {/* While a payment is unconfirmed, look again every few seconds (no JavaScript needed). */}
      {waiting && returned ? <meta httpEquiv="refresh" content="3" /> : null}
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/services">Lunch and clubs</Link>
      </p>
      <h1>Your order</h1>
      {waiting && returned ? (
        <p role="status" data-testid="awaiting-confirmation">
          Waiting for the payment provider to confirm your payment. This page updates by itself.
        </p>
      ) : null}
      {waiting && query.cancelled ? (
        <p role="status" data-testid="payment-not-completed">
          The payment was not completed. Your places stay held until the time below runs out.
        </p>
      ) : null}
      {orders.map((order) => (
        <OrderCard key={order.orderId} order={order} />
      ))}
    </main>
  );
}

function OrderCard({ order }: { order: Order }) {
  const status = orderStatus(order);
  const left = status.settled ? null : minutesLeft(order.expiresAt);
  return (
    <section
      aria-labelledby={`order-${order.orderId}`}
      data-testid="order"
      data-status={order.status}
      style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
    >
      <h2 id={`order-${order.orderId}`}>
        {order.orderNumber}: <span data-testid="order-status">{status.label}</span>
      </h2>
      <p>{status.detail}</p>
      <p>
        {`Billed by ${order.billingEntityName}. Total ${formatMoney(order.totalMinor, order.currency)}.`}
        {order.payment?.provider === 'development' ? (
          <strong data-testid="development-payment"> Development payment: no money moved.</strong>
        ) : null}
      </p>
      {left !== null ? <p>{`Places held for about ${left} more minutes.`}</p> : null}
      {order.checkoutUrl ? (
        <p>
          <a href={order.checkoutUrl} data-testid="pay-now">
            {`Pay ${formatMoney(order.totalMinor, order.currency)} now`}
          </a>
        </p>
      ) : null}
      <table style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Item</th>
            <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Child</th>
            <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Day</th>
            <th style={{ textAlign: 'right', paddingRight: '1rem' }}>Amount</th>
            <th style={{ textAlign: 'left' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((line, index) => (
            <tr key={index}>
              <td style={{ paddingRight: '1rem' }}>{line.description}</td>
              <td style={{ paddingRight: '1rem' }}>{line.studentName ?? ''}</td>
              <td style={{ paddingRight: '1rem' }}>
                {line.serviceDate ? formatServiceDate(line.serviceDate) : ''}
              </td>
              <td style={{ textAlign: 'right', paddingRight: '1rem' }}>
                {formatMoney(line.totalMinor, order.currency)}
              </td>
              <td>{lineStatus(line.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
