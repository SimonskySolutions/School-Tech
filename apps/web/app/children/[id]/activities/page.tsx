import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchStudentActivities, fetchStudentWaitingList } from '../../../../lib/api-client';
import { OPERATIONS_NOTICES } from '../../../../lib/operations';
import { attendanceLabel, formatSessionTime } from '../../../../lib/school-life';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** A guardian sees their child's club meetings and whether they attended. */
export default async function ChildActivitiesPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchStudentActivities(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Clubs and attendance</h1>
        <p data-testid="not-permitted">This child is not linked to your account.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const child = result.value;
  const queue = await fetchStudentWaitingList(config.API_INTERNAL_URL, session.accessToken, id);
  const waiting = queue.kind === 'ok' ? queue.value.entries : [];
  const done = typeof query.done === 'string' ? (OPERATIONS_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const past = child.sessions.filter((entry) => entry.started);
  const upcoming = child.sessions.filter((entry) => !entry.started);

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/services">Book lunch and clubs</Link>
      </p>
      <h1>{`Clubs and attendance: ${child.student.givenName} ${child.student.familyName}`}</h1>
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
      {waiting.length > 0 ? (
        <section aria-labelledby="waiting" data-testid="waiting">
          <h2 id="waiting">Waiting lists</h2>
          <ul>
            {waiting.map((entry) => (
              <li key={entry.id}>
                {entry.offeringName}:{' '}
                {entry.status === 'place_free' ? (
                  <>
                    <span className="badge ok">A place is free</span>{' '}
                    <Link href="/services">Book it now</Link>
                  </>
                ) : (
                  `number ${entry.position} in the queue`
                )}
                <form method="post" action={`/children/${child.student.id}/waiting-list`}>
                  <input type="hidden" name="entry_id" value={entry.id} />
                  <button type="submit">Leave the list</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {child.sessions.length === 0 ? <p>No club meetings booked.</p> : null}
      {past.length ? (
        <section aria-labelledby="past" data-testid="past">
          <h2 id="past">Meetings so far</h2>
          <ul>
            {past.map((entry, index) => (
              <li key={index}>
                {`${entry.offeringName}, ${formatSessionTime(entry.startsAt, entry.endsAt, entry.timeZone)}: ${
                  entry.status === 'confirmed' ? 'Not marked yet' : attendanceLabel(entry.status)
                }`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {upcoming.length ? (
        <section aria-labelledby="upcoming" data-testid="upcoming">
          <h2 id="upcoming">Coming up</h2>
          <ul>
            {upcoming.map((entry, index) => (
              <li key={index}>
                {`${entry.offeringName}, ${formatSessionTime(entry.startsAt, entry.endsAt, entry.timeZone)}${
                  entry.location ? `, ${entry.location}` : ''
                }`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
