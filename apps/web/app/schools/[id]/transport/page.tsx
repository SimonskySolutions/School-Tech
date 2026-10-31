import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolTransport } from '../../../../lib/api-client';
import { WEEKDAY_NAMES } from '../../../../lib/lessons';
import { currentSession, runtime } from '../../../../lib/server';
import { termDates, TRANSPORT_NOTICES } from '../../../../lib/transport';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const grid = { display: 'grid', gap: '0.5rem', maxWidth: '32rem', margin: '0.5rem 0 1rem' } as const;

/** A school's bus routes: vehicle, days, stops and the term's seats (ADR 0024). */
export default async function SchoolTransportPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolTransport(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Transport</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (TRANSPORT_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const action = `/schools/${view.school.id}/transport/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/school-life/transport">Today&apos;s lists for drivers</Link>
      </p>
      <h1>{`Transport at ${view.school.name}`}</h1>
      {done ? (
        <p role="status" data-testid="done">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="error">
          {error}
        </p>
      ) : null}
      <p>
        Each route is a transport offering on the set-up page, for one term: give it a term calendar there
        (the seats are its places). Families buy a seat for the term and choose their stop.
      </p>
      {view.offerings.length === 0 ? <p>No transport offerings yet.</p> : null}
      {view.offerings.map((offering) => (
        <section
          key={offering.id}
          aria-labelledby={`bus-${offering.id}`}
          data-testid={`bus-${offering.name}`}
        >
          <h2 id={`bus-${offering.id}`}>{offering.name}</h2>
          {offering.terms.map((term) => (
            <p key={term.sessionId} data-testid="term">
              {`${term.label ?? 'Term'}: ${termDates(term.startsAt, term.endsAt, view.school.timeZone)} · ${term.taken}${term.seats === null ? '' : ` of ${term.seats}`} seats taken${term.awaitingPayment ? `, ${term.awaitingPayment} unpaid` : ''}`}
            </p>
          ))}
          {offering.route ? (
            <>
              <p>
                {[offering.route.vehicle, offering.route.weekdays.map((d) => WEEKDAY_NAMES[d - 1]).join(', ')]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <ol data-testid="stops">
                {offering.route.stops.map((stop) => (
                  <li key={stop.id}>
                    {`${stop.name} · pick-up ${stop.pickupTime}${stop.dropoffTime ? ` · back ${stop.dropoffTime}` : ''}${stop.active ? '' : ' (no longer served)'}`}
                  </li>
                ))}
              </ol>
              {view.canManage ? (
                <form method="post" action={action} style={grid} data-testid="add-stop">
                  <input type="hidden" name="action" value="add-stop" />
                  <input type="hidden" name="offering_id" value={offering.id} />
                  <label>
                    Stop <input name="name" required maxLength={120} />
                  </label>
                  <label>
                    Pick-up <input name="pickup_time" required placeholder="07:30" size={5} />
                  </label>
                  <label>
                    Back (optional) <input name="dropoff_time" placeholder="16:30" size={5} />
                  </label>
                  <button type="submit">Add the stop at the end</button>
                </form>
              ) : null}
            </>
          ) : view.canManage ? (
            <form method="post" action={action} style={grid} data-testid="add-route">
              <input type="hidden" name="action" value="add-route" />
              <input type="hidden" name="offering_id" value={offering.id} />
              <label>
                Vehicle <input name="vehicle" maxLength={120} placeholder="Minibus, plate" />
              </label>
              <fieldset>
                <legend>Runs on</legend>
                {WEEKDAY_NAMES.map((name, index) => (
                  <label key={name} style={{ marginRight: '0.75rem' }}>
                    <input type="checkbox" name="weekday" value={index + 1} defaultChecked={index < 5} />{' '}
                    {name}
                  </label>
                ))}
              </fieldset>
              <button type="submit">Set up the route</button>
            </form>
          ) : (
            <p>No route set up yet.</p>
          )}
        </section>
      ))}
    </main>
  );
}
