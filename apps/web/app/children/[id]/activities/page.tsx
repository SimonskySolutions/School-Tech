import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchStudentActivities } from '../../../../lib/api-client';
import { attendanceLabel, formatSessionTime } from '../../../../lib/school-life';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** A guardian sees their child's club meetings and whether they attended. */
export default async function ChildActivitiesPage({ params }: { params: Params }) {
  const { id } = await params;
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
  const past = child.sessions.filter((entry) => entry.started);
  const upcoming = child.sessions.filter((entry) => !entry.started);

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/services">Book lunch and clubs</Link>
      </p>
      <h1>{`Clubs and attendance: ${child.student.givenName} ${child.student.familyName}`}</h1>
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
