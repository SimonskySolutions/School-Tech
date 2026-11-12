import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolLifeDay } from '../../../lib/api-client';
import {
  dayHref,
  dietaryLabel,
  formatDay,
  formatSessionTime,
  isUrgent,
  readDayQuery,
} from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * One school on one day (M4.8): lunch, clubs and lessons, trips, buses,
 * uniforms, families' requests and dietary needs to verify, each linking to
 * the page where the work is done. Each part shows only what the role may see.
 */
export default async function SchoolLifeDayPage({ searchParams }: { searchParams: SearchParams }) {
  const { schoolId, date } = readDayQuery(await searchParams);
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolLifeDay(config.API_INTERNAL_URL, session.accessToken, schoolId, date);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>The day at school</h1>
        <p data-testid="not-permitted">This page is for school staff at their own schools.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const day = result.value;
  const school = day.school;
  const range = `from=${day.date}&days=1`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`${school.name}: ${formatDay(day.date)}`}</h1>
      {day.schools.length > 1 ? (
        <p data-testid="schools">
          {day.schools.map((entry, index) => (
            <span key={entry.id}>
              {index > 0 ? ' · ' : null}
              {entry.id === school.id ? (
                <strong>{entry.name}</strong>
              ) : (
                <Link href={dayHref(entry.id, day.date)}>{entry.name}</Link>
              )}
            </span>
          ))}
        </p>
      ) : null}
      <p>
        <Link href={dayHref(school.id, day.date, -1)}>Day before</Link> ·{' '}
        <Link href={dayHref(school.id, day.date, 1)}>Next day</Link>
      </p>
      <form method="get" action="/school-life/day">
        <input type="hidden" name="schoolId" value={school.id} />
        <label>
          Day <input type="date" name="date" defaultValue={day.date} />
        </label>{' '}
        <button type="submit">Show</button>
      </form>

      <section aria-labelledby="day-lunch" data-testid="day-lunch">
        <h2 id="day-lunch">Lunch</h2>
        {day.lunch ? (
          <>
            <p data-testid="day-meals">
              {`${plural(day.lunch.meals, 'meal', 'meals')} paid, ${day.lunch.awaitingPayment} awaiting payment${day.lunch.capacity === null ? '' : ` (kitchen capacity ${day.lunch.capacity})`}`}
            </p>
            <p>
              {day.lunch.dishes === 0
                ? 'The menu is not published.'
                : `${plural(day.lunch.dishes, 'dish', 'dishes')} on the menu.`}
            </p>
            {day.lunch.showsDietary ? (
              day.lunch.alerts.length === 0 ? (
                <p>No dietary needs among the children eating.</p>
              ) : (
                <ul data-testid="day-dietary">
                  {day.lunch.alerts.map((alert, index) => {
                    const warn = alert.onMenu.length > 0 || isUrgent(alert.severity);
                    return (
                      <li
                        key={index}
                        role={warn ? 'alert' : undefined}
                        data-testid={alert.onMenu.length > 0 ? 'day-menu-conflict' : undefined}
                        style={warn ? { color: '#9b1c1c', fontWeight: 600 } : undefined}
                      >
                        {`${alert.studentName ?? 'A child'}${alert.classLabel ? ` (${alert.classLabel})` : ''}: ${dietaryLabel(alert.kind, alert.severity)}, ${alert.description}${alert.verified ? '' : ' (not yet verified)'}${alert.onMenu.length > 0 ? `. On this child’s lunch: ${alert.onMenu.join(', ')}` : ''}`}
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <p>Dietary needs are not shown for your role.</p>
            )}
            <p>
              <Link href={`/school-life/kitchen?${range}`}>Kitchen counts</Link> ·{' '}
              <Link href={`/school-life/lunch?schoolId=${school.id}&date=${day.date}`}>Who eats</Link>
            </p>
          </>
        ) : (
          <p>No lunch is served on this day.</p>
        )}
      </section>

      <section aria-labelledby="day-sessions" data-testid="day-sessions">
        <h2 id="day-sessions">Clubs and lessons</h2>
        {day.sessions.length === 0 ? <p>Nothing meets on this day.</p> : null}
        <ul>
          {day.sessions.map((entry) => (
            <li key={entry.id} data-testid="day-session">
              {`${entry.name}, ${formatSessionTime(entry.startsAt, entry.endsAt, school.timeZone)}${entry.location ? `, ${entry.location}` : ''}: ${plural(entry.booked, 'child', 'children')}, register ${entry.marked} of ${entry.booked} marked`}
            </li>
          ))}
        </ul>
        <p>
          <Link href={`/school-life/registers?${range}`}>Registers</Link>
        </p>
      </section>

      <section aria-labelledby="day-trips" data-testid="day-trips">
        <h2 id="day-trips">Trips</h2>
        {day.trips.length === 0 ? <p>No trip on this day.</p> : null}
        <ul>
          {day.trips.map((trip) => (
            <li
              key={trip.sessionId}
              role={trip.withoutPermission > 0 ? 'alert' : undefined}
              data-testid="day-trip"
            >
              {`${trip.name}, ${formatSessionTime(trip.startsAt, null, school.timeZone)}: ${trip.booked}${trip.capacity === null ? '' : ` of ${trip.capacity}`} going${trip.withoutPermission > 0 ? `, ${plural(trip.withoutPermission, 'child', 'children')} without permission` : ''}`}
            </li>
          ))}
        </ul>
        <p>
          <Link href={`/school-life/trips?${range}`}>Trip lists</Link>
        </p>
      </section>

      <section aria-labelledby="day-transport" data-testid="day-transport">
        <h2 id="day-transport">Buses</h2>
        {day.transport.length === 0 ? <p>No bus runs on this day.</p> : null}
        <ul>
          {day.transport.map((route) => (
            <li key={route.name} data-testid="day-route">
              {`${route.name}: ${route.riders}${route.seats === null ? '' : ` of ${route.seats}`} seats taken${route.firstPickup ? `, first pick-up ${route.firstPickup}` : ''}`}
            </li>
          ))}
        </ul>
        <p>
          <Link href={`/school-life/transport?from=${day.date}`}>Drivers&apos; lists</Link>
        </p>
      </section>

      {day.uniforms ? (
        <section aria-labelledby="day-uniforms" data-testid="day-uniforms">
          <h2 id="day-uniforms">Uniforms</h2>
          <p data-testid="day-uniforms-count">
            {`${plural(day.uniforms.awaitingHandOver, 'item', 'items')} paid and waiting to be handed over; ${plural(day.uniforms.lowStock, 'size', 'sizes')} running low`}
          </p>
          <p>
            <Link href={`/schools/${school.id}/uniforms`}>Uniform stock and hand-over</Link>
          </p>
        </section>
      ) : null}

      {day.requests ? (
        <section aria-labelledby="day-requests" data-testid="day-requests">
          <h2 id="day-requests">Families&apos; requests</h2>
          <p data-testid="day-requests-count">
            {`${day.requests.waiting} waiting for an answer, ${day.requests.inProgress} being worked on`}
          </p>
          <p>
            <Link href="/school-life/requests?status=open">Answer requests</Link>
          </p>
        </section>
      ) : null}

      {day.dietaryToVerify !== null ? (
        <section aria-labelledby="day-verify" data-testid="day-verify">
          <h2 id="day-verify">Dietary needs to verify</h2>
          <p>{`${plural(day.dietaryToVerify, 'need', 'needs')} declared by families and not yet verified`}</p>
          <p>
            <Link href="/school-life/dietary">Verify dietary needs</Link>
          </p>
        </section>
      ) : null}
    </main>
  );
}
