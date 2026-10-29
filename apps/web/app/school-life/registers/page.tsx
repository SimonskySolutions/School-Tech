import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchRegisters } from '../../../lib/api-client';
import { attendanceLabel, formatSessionTime, readRange, shiftRange } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Club and activity sessions with the children booked on them (paid bookings only). */
export default async function RegistersPage({ searchParams }: { searchParams: SearchParams }) {
  const { from, days } = readRange(await searchParams);
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchRegisters(config.API_INTERNAL_URL, session.accessToken, from, days);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Club registers</h1>
        <p data-testid="not-permitted">This page is for school staff. Your account cannot see bookings.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const registers = result.value;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/school-life/kitchen">Kitchen</Link>
      </p>
      <h1>Club registers</h1>
      <p>
        <Link href={`/school-life/registers${shiftRange(registers.from, registers.days, -1)}`}>Earlier</Link>{' '}
        · <Link href={`/school-life/registers${shiftRange(registers.from, registers.days, 1)}`}>Later</Link>
      </p>
      {registers.sessions.length === 0 ? <p>No club meets at your schools in these days.</p> : null}
      {registers.sessions.map((entry) => (
        <section
          key={entry.id}
          aria-labelledby={`register-${entry.id}`}
          data-testid="register"
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2 id={`register-${entry.id}`}>
            {`${entry.offering.name}: ${formatSessionTime(entry.startsAt, entry.endsAt, entry.school.timeZone)}`}
          </h2>
          <p>
            {[
              entry.school.name,
              entry.location,
              `${entry.booked}${entry.capacity === null ? '' : ` of ${entry.capacity}`} booked`,
              entry.awaitingPayment ? `${entry.awaitingPayment} unpaid` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {entry.attendees.length === 0 ? (
            <p>Nobody is booked yet.</p>
          ) : (
            <ol data-testid="attendees">
              {entry.attendees.map((attendee, index) => (
                <li key={index}>
                  {`${attendee.studentName ?? 'Name hidden for your role'}${attendee.classLabel ? `, ${attendee.classLabel}` : ''}: ${attendanceLabel(attendee.status)}`}
                </li>
              ))}
            </ol>
          )}
        </section>
      ))}
    </main>
  );
}
