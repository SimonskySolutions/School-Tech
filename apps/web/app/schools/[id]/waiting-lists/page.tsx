import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolWaitingLists } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** Who is queueing for the school's full clubs, in order. */
export default async function SchoolWaitingListsPage({ params }: { params: Params }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolWaitingLists(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Waiting lists</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const clubs = [...new Set(view.entries.map((entry) => entry.offeringName))];
  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Waiting lists at ${view.school.name}`}</h1>
      <p>When a place comes free, the first family is told by e-mail and can book it.</p>
      {clubs.length === 0 ? (
        <section data-testid="no-waiting">
          <p>Nobody is waiting for a club.</p>
        </section>
      ) : null}
      {clubs.map((club) => (
        <section key={club} aria-label={club} data-testid="waiting-club">
          <h2>{club}</h2>
          <ul>
            {view.entries
              .filter((entry) => entry.offeringName === club)
              .map((entry) => (
                <li key={entry.id}>
                  {`${entry.position}. ${entry.student}, since ${entry.since} `}
                  {entry.status === 'place_free' ? <span className="badge ok">Place offered</span> : null}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </main>
  );
}
