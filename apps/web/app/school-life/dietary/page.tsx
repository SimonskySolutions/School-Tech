import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchDietaryReview } from '../../../lib/api-client';
import { allergenNames, DIETARY_DONE } from '../../../lib/dietary';
import { dietaryLabel, formatDay, isUrgent } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Children's current dietary needs per school, unverified first, for School Life to check with the family. */
export default async function DietaryReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchDietaryReview(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Dietary needs</h1>
        <p data-testid="not-permitted">This page is for School Life and school leaders.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const done = typeof params.done === 'string' ? (DIETARY_DONE[params.done] ?? null) : null;
  const error = typeof params.error === 'string' ? params.error : null;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/school-life/kitchen">Kitchen</Link> ·{' '}
        <Link href="/school-life/menus">Lunch menus</Link>
      </p>
      <h1>Dietary needs</h1>
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
        Verify a need once you have checked it with the family (and, for medical needs, the evidence the
        school asks for). A family&apos;s later change makes it unverified again. Every view of this page is
        recorded.
      </p>
      {result.value.schools.length === 0 ? <p>No current needs at your schools.</p> : null}
      {result.value.schools.map((entry) => (
        <section
          key={entry.school.id}
          aria-labelledby={`dietary-${entry.school.id}`}
          data-testid={`dietary-${entry.school.name}`}
        >
          <h2 id={`dietary-${entry.school.id}`}>{entry.school.name}</h2>
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Child</th>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Need</th>
                <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Allergens</th>
                <th style={{ textAlign: 'left' }}>Verified</th>
              </tr>
            </thead>
            <tbody>
              {entry.needs.map((need) => (
                <tr key={need.id} data-testid={`need-${need.id}`} style={{ verticalAlign: 'top' }}>
                  <td style={{ paddingRight: '1rem' }}>
                    {`${need.studentName}${need.classLabel ? ` (${need.classLabel})` : ''}`}
                  </td>
                  <td
                    style={{
                      paddingRight: '1rem',
                      ...(isUrgent(need.severity) ? { color: '#9b1c1c', fontWeight: 600 } : {}),
                    }}
                  >
                    {`${dietaryLabel(need.kind, need.severity)}: ${need.description}`}
                    {need.validUntil ? ` (until ${formatDay(need.validUntil)})` : ''}
                  </td>
                  <td style={{ paddingRight: '1rem' }}>{allergenNames(need.allergens) || 'None ticked'}</td>
                  <td>
                    {need.verified ? (
                      'Yes'
                    ) : entry.canVerify ? (
                      <form method="post" action="/school-life/dietary/actions">
                        <input type="hidden" name="need_id" value={need.id} />
                        <button type="submit" data-testid="verify">
                          Verify
                        </button>
                      </form>
                    ) : (
                      'Not yet'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
