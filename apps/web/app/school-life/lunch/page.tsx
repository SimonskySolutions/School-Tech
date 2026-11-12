import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { fetchLunchList } from '../../../lib/api-client';
import { CANCEL_NOTICES, formatDay, readLunchQuery } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The children booked for lunch at one school on one day. Staff who may change
 * bookings can cancel a child's lunch; the family then receives credit for
 * exactly that day, and nothing else about the child changes.
 */
export default async function LunchListPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = readLunchQuery(params);
  if (!query) notFound();
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchLunchList(
    config.API_INTERNAL_URL,
    session.accessToken,
    query.schoolId,
    query.date,
  );
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') notFound();
  const list = result.value;
  const notice = typeof params.notice === 'string' ? (CANCEL_NOTICES[params.notice] ?? null) : null;
  const booked = list.bookings.filter((booking) => booking.status !== 'cancelled');
  const cancelled = list.bookings.filter((booking) => booking.status === 'cancelled');

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href={`/school-life/kitchen?from=${list.date}`}>Kitchen</Link>
      </p>
      <h1>{`Lunch at ${list.school.name}, ${formatDay(list.date)}`}</h1>
      {notice ? (
        <p role="status" data-testid="cancel-notice">
          {notice}
        </p>
      ) : null}
      <p>{`${booked.length} ${booked.length === 1 ? 'child' : 'children'} booked.`}</p>
      {booked.length === 0 ? null : (
        <table style={{ borderCollapse: 'collapse' }} data-testid="lunch-list">
          <tbody>
            {booked.map((booking) => (
              <tr key={booking.bookingId} data-testid="lunch-booking" style={{ verticalAlign: 'top' }}>
                <td style={{ padding: '0.25rem 1rem 0.25rem 0' }}>
                  {`${booking.studentName ?? 'Name hidden for your role'}${booking.classLabel ? `, ${booking.classLabel}` : ''}`}
                </td>
                <td>
                  {list.canCancel && booking.status === 'confirmed' ? (
                    <form
                      method="post"
                      action="/school-life/cancel"
                      style={{ display: 'flex', gap: '0.5rem' }}
                    >
                      <input type="hidden" name="booking_id" value={booking.bookingId} />
                      <input type="hidden" name="school_id" value={list.school.id} />
                      <input type="hidden" name="date" value={list.date} />
                      <label>
                        <span style={{ position: 'absolute', left: '-9999px' }}>Reason</span>
                        <input
                          name="reason"
                          required
                          minLength={3}
                          maxLength={200}
                          placeholder="Reason, e.g. absent"
                          data-testid="cancel-reason"
                        />
                      </label>
                      <button type="submit" data-testid="cancel-lunch">
                        Cancel lunch and credit the family
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {cancelled.length > 0 ? (
        <>
          <h2>Cancelled by the school</h2>
          <ul data-testid="cancelled-list">
            {cancelled.map((booking) => (
              <li key={booking.bookingId}>
                {`${booking.studentName ?? 'Name hidden for your role'}${booking.classLabel ? `, ${booking.classLabel}` : ''}`}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
