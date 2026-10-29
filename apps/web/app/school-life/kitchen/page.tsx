import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchKitchenCounts } from '../../../lib/api-client';
import { dietaryLabel, formatDay, isUrgent, readRange, shiftRange } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Lunches to prepare per school and day. Only paid bookings count as meals;
 * dietary needs appear only for viewers allowed to see them (row-level security).
 */
export default async function KitchenPage({ searchParams }: { searchParams: SearchParams }) {
  const { from, days } = readRange(await searchParams);
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchKitchenCounts(config.API_INTERNAL_URL, session.accessToken, from, days);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') return <NotForYou />;
  const counts = result.value;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/school-life/registers">Club registers</Link>
      </p>
      <h1>Kitchen: lunches per day</h1>
      <p>
        <Link href={`/school-life/kitchen${shiftRange(counts.from, counts.days, -1)}`}>Earlier</Link> ·{' '}
        <Link href={`/school-life/kitchen${shiftRange(counts.from, counts.days, 1)}`}>Later</Link>
      </p>
      <p>Meals count paid bookings. Unpaid reservations may still be paid or released.</p>
      {counts.schools.length === 0 ? <p>No lunch is served at your schools in these days.</p> : null}
      {counts.schools.map((entry) => (
        <section
          key={entry.school.id}
          aria-labelledby={`kitchen-${entry.school.id}`}
          data-testid={`kitchen-${entry.school.name}`}
        >
          <h2 id={`kitchen-${entry.school.id}`}>{entry.school.name}</h2>
          {entry.showsDietary ? null : (
            <p data-testid="dietary-hidden">Dietary needs are not shown for your role.</p>
          )}
          <table style={{ borderCollapse: 'collapse', marginBottom: '1rem' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Day</th>
                <th style={{ textAlign: 'right', paddingRight: '1rem' }}>Meals</th>
                <th style={{ textAlign: 'right', paddingRight: '1rem' }}>Unpaid</th>
                {entry.showsDietary ? <th style={{ textAlign: 'left' }}>Dietary needs</th> : null}
              </tr>
            </thead>
            <tbody>
              {entry.days.map((day) => (
                <tr key={day.date} data-testid={`day-${day.date}`} style={{ verticalAlign: 'top' }}>
                  <td style={{ paddingRight: '1rem' }}>
                    <Link href={`/school-life/lunch?schoolId=${entry.school.id}&date=${day.date}`}>
                      {formatDay(day.date)}
                    </Link>
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '1rem' }} data-testid="meals">
                    {day.meals}
                  </td>
                  <td style={{ textAlign: 'right', paddingRight: '1rem' }}>{day.awaitingPayment}</td>
                  {entry.showsDietary ? (
                    <td>
                      {day.dietary.length === 0 ? (
                        'None'
                      ) : (
                        <ul style={{ margin: 0, paddingLeft: '1rem' }}>
                          {day.dietary.map((need, index) => (
                            <li
                              key={index}
                              role={isUrgent(need.severity) ? 'alert' : undefined}
                              style={
                                isUrgent(need.severity) ? { color: '#9b1c1c', fontWeight: 600 } : undefined
                              }
                            >
                              {`${need.studentName ?? 'A child'}${need.classLabel ? ` (${need.classLabel})` : ''}: ${dietaryLabel(need.kind, need.severity)}, ${need.description}`}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}

function NotForYou() {
  return (
    <main>
      <DevelopmentBanner />
      <h1>Kitchen: lunches per day</h1>
      <p data-testid="not-permitted">This page is for school staff. Your account cannot see bookings.</p>
      <p>
        <Link href="/">Home</Link>
      </p>
    </main>
  );
}
