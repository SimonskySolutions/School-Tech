import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchTripParticipants } from '../../../lib/api-client';
import { dietaryLabel, formatSessionTime, isUrgent, readRange, shiftRange } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CHANNELS: Record<string, string> = {
  family_portal: 'online',
  paper: 'on paper',
  in_person: 'in person',
};

/** Trips with who is coming: permission, emergency contact and, for those allowed, dietary needs. */
export default async function TripsPage({ searchParams }: { searchParams: SearchParams }) {
  const { from } = readRange(await searchParams);
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchTripParticipants(config.API_INTERNAL_URL, session.accessToken, from);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Trips</h1>
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
        <Link href="/">Home</Link> · <Link href="/school-life/registers">Registers</Link>
      </p>
      <h1>Trips: who is coming</h1>
      <p>
        <Link href={`/school-life/trips${shiftRange(view.from, view.days, -1)}`}>Earlier</Link> ·{' '}
        <Link href={`/school-life/trips${shiftRange(view.from, view.days, 1)}`}>Later</Link>
      </p>
      {view.trips.length === 0 ? <p>No trips at your schools in these days.</p> : null}
      {view.trips.map((trip) => (
        <section
          key={trip.sessionId}
          aria-labelledby={`trip-${trip.sessionId}`}
          data-testid={`trip-${trip.name}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2
            id={`trip-${trip.sessionId}`}
          >{`${trip.name}: ${formatSessionTime(trip.startsAt, trip.endsAt, trip.school.timeZone)}`}</h2>
          <p>
            {[
              trip.school.name,
              trip.location,
              `${trip.booked}${trip.capacity === null ? '' : ` of ${trip.capacity}`} booked`,
              trip.awaitingPayment ? `${trip.awaitingPayment} unpaid` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {trip.participants.length === 0 ? (
            <p>Nobody is booked yet.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Child</th>
                  <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Permission</th>
                  <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Emergency contact</th>
                  <th style={{ textAlign: 'left' }}>Dietary and health</th>
                </tr>
              </thead>
              <tbody>
                {trip.participants.map((person, index) => (
                  <tr key={index} data-testid="participant" style={{ verticalAlign: 'top' }}>
                    <td style={{ paddingRight: '1rem' }}>
                      {`${person.studentName ?? 'Name hidden for your role'}${person.classLabel ? `, ${person.classLabel}` : ''}`}
                    </td>
                    <td style={{ paddingRight: '1rem' }}>
                      {person.permission
                        ? `Given ${CHANNELS[person.permission.channel] ?? ''}${person.permission.givenBy ? ` by ${person.permission.givenBy}` : ''}`
                        : 'Missing'}
                    </td>
                    <td style={{ paddingRight: '1rem' }}>
                      {person.emergencyContact
                        ? `${person.emergencyContact.name}, ${person.emergencyContact.phone}`
                        : '—'}
                    </td>
                    <td>
                      {person.dietary.length === 0
                        ? '—'
                        : person.dietary.map((need, i) => (
                            <div
                              key={i}
                              role={isUrgent(need.severity) ? 'alert' : undefined}
                              style={
                                isUrgent(need.severity) ? { color: '#9b1c1c', fontWeight: 600 } : undefined
                              }
                            >
                              {`${dietaryLabel(need.kind, need.severity)}: ${need.description}`}
                            </div>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}
    </main>
  );
}
