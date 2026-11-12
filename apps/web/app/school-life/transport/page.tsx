import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchTransportRuns } from '../../../lib/api-client';
import { formatDay, readRange, shiftRange } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** The day's list for each bus: stops in order with their times, and who boards at each. */
export default async function TransportPage({ searchParams }: { searchParams: SearchParams }) {
  const { from } = readRange(await searchParams);
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchTransportRuns(config.API_INTERNAL_URL, session.accessToken, from);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Transport</h1>
        <p data-testid="not-permitted">This page is for school staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Transport: ${formatDay(view.date)}`}</h1>
      <p>
        <Link href={`/school-life/transport${shiftRange(view.date, 1, -1)}`}>Day before</Link> ·{' '}
        <Link href={`/school-life/transport${shiftRange(view.date, 1, 1)}`}>Next day</Link>
      </p>
      <form method="get" action="/school-life/transport">
        <label>
          Day <input type="date" name="from" defaultValue={view.date} />
        </label>{' '}
        <button type="submit">Show</button>
      </form>
      {view.routes.length === 0 ? <p>No bus runs at your schools on this day.</p> : null}
      {view.routes.map((route) => (
        <section
          key={route.sessionId}
          aria-labelledby={`route-${route.sessionId}`}
          data-testid={`route-${route.name}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2 id={`route-${route.sessionId}`}>{route.name}</h2>
          <p>
            {[
              route.school.name,
              route.term,
              route.vehicle,
              `${route.riders}${route.seats === null ? '' : ` of ${route.seats}`} seats taken`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <ol>
            {route.stops.map((stop, index) => (
              <li key={index} data-testid="stop">
                <strong>{stop.name}</strong>
                {` · pick-up ${stop.pickupTime}${stop.dropoffTime ? ` · back ${stop.dropoffTime}` : ''}`}
                {stop.children.length === 0 ? (
                  <div>Nobody</div>
                ) : (
                  <ul>
                    {stop.children.map((child, i) => (
                      <li key={i}>
                        {`${child.studentName ?? 'Name hidden for your role'}${child.classLabel ? `, ${child.classLabel}` : ''}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
