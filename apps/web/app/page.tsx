import { fetchMe, fetchSchools } from '../lib/api-client';
import { buildHome, type HomeView, NOTICES } from '../lib/home';
import { currentSession, runtime } from '../lib/server';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function notice(params: Record<string, string | string[] | undefined>): string | null {
  if (params['signed-out']) return NOTICES['signed-out'] ?? null;
  const error = typeof params.error === 'string' ? params.error : null;
  return error ? (NOTICES[error] ?? null) : null;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const message = notice(await searchParams);
  const session = await currentSession();

  if (!session) {
    return <SignedOut message={message} />;
  }

  const { config } = runtime();
  const [me, schools] = await Promise.all([
    fetchMe(config.API_INTERNAL_URL, session.accessToken),
    fetchSchools(config.API_INTERNAL_URL, session.accessToken),
  ]);
  if (me.kind !== 'ok') {
    return <SignedOut message={NOTICES['sign-in-failed'] ?? null} />;
  }
  return <Home view={buildHome(me.value, schools.kind === 'ok' ? schools.value : [])} />;
}

function DevelopmentBanner() {
  return (
    <p style={{ background: '#fff4ce', padding: '0.5rem 0.75rem', borderRadius: 4 }}>
      Development build with synthetic data. Payments are not connected.
    </p>
  );
}

function SignedOut({ message }: { message: string | null }) {
  return (
    <main>
      <DevelopmentBanner />
      <h1>Pythagoras</h1>
      {message ? <p role="status">{message}</p> : null}
      <p>Parents and staff sign in with their Pythagoras account.</p>
      <p>
        <a href="/auth/sign-in" data-testid="sign-in">
          Sign in
        </a>
      </p>
    </main>
  );
}

function Home({ view }: { view: HomeView }) {
  return (
    <main>
      <DevelopmentBanner />
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>{view.greeting}</h1>
        <form method="post" action="/auth/sign-out">
          <button type="submit" data-testid="sign-out">
            Sign out
          </button>
        </form>
      </header>

      {view.children.length > 0 ? (
        <section aria-labelledby="children" data-testid="children">
          <h2 id="children">Your children</h2>
          <ul>
            {view.children.map((child) => (
              <li key={child.id}>
                <strong>{child.name}</strong>: {child.places.join('; ') || 'no current enrolment'}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.schoolRoles.length > 0 ? (
        <section aria-labelledby="school-roles" data-testid="school-roles">
          <h2 id="school-roles">Your school</h2>
          <ul>
            {view.schoolRoles.map((entry) => (
              <li key={`${entry.role}-${entry.school}`}>{`${entry.role} at ${entry.school}`}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.groupRoles.length > 0 ? (
        <section aria-labelledby="group-roles" data-testid="group-roles">
          <h2 id="group-roles">Across the group</h2>
          <p>{view.groupRoles.join(', ')}: all schools</p>
          <ul>
            {view.groupSchools.map((school) => (
              <li key={school}>{school}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.hasNothing ? (
        <p data-testid="nothing-yet">
          Your account has no children or roles linked yet. If you expected to see your children, please
          contact the school office: a member of staff needs to confirm the link.
        </p>
      ) : null}
    </main>
  );
}
