import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchStudentConsents } from '../../../../lib/api-client';
import { CONSENT_NOTICES } from '../../../../lib/consents';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A guardian reads each purpose's wording and gives or withdraws consent (M6.6, ADR 0030). */
export default async function ChildConsentsPage({
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
  const result = await fetchStudentConsents(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Consents</h1>
        <p data-testid="not-permitted">This child is not linked to your account.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const child = result.value;
  const done = typeof query.done === 'string' ? (CONSENT_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const action = `/children/${child.student.id}/consents/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Consents: ${child.student.givenName} ${child.student.familyName}`}</h1>
      <p>
        Each consent is your choice, for this purpose only. You can withdraw it at any time, as easily as you
        gave it; it then stops counting at once. Permission for a trip is asked for on the trips page.
      </p>
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
      {child.consents.length === 0 ? <p>The school asks for no consent at the moment.</p> : null}
      {child.consents.map((consent) => (
        <section
          key={consent.purposeId}
          aria-labelledby={`purpose-${consent.purposeId}`}
          data-testid={`consent-${consent.code}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2 id={`purpose-${consent.purposeId}`}>{consent.name}</h2>
          <blockquote style={{ borderLeft: '3px solid #ccc', margin: '0.5rem 0', paddingLeft: '0.75rem' }}>
            {consent.wording.text}
          </blockquote>
          <p data-testid="state">
            {consent.state === 'given'
              ? `Consent given${consent.givenBy ? ` by ${consent.givenBy}` : ''} on ${consent.givenAt!.slice(0, 10)}.`
              : consent.state === 'renewal'
                ? `The school has changed what it asks since consent was given (version ${consent.givenForVersion}); it no longer counts until you agree to the wording above.`
                : 'No consent given.'}
          </p>
          {child.mayConsent && consent.state !== 'given' ? (
            <form method="post" action={action} style={{ display: 'grid', gap: '0.5rem', maxWidth: '32rem' }}>
              <input type="hidden" name="action" value="give" />
              <input type="hidden" name="purpose_id" value={consent.purposeId} />
              <input type="hidden" name="wording_id" value={consent.wording.id} />
              <label>
                <input type="checkbox" name="agree" value="yes" required /> I have read the wording above and
                give consent.
              </label>
              <button type="submit" data-testid="give">
                Give consent
              </button>
            </form>
          ) : null}
          {child.mayConsent && consent.state !== 'none' ? (
            <form method="post" action={action}>
              <input type="hidden" name="action" value="withdraw" />
              <input type="hidden" name="purpose_id" value={consent.purposeId} />
              <button type="submit" data-testid="withdraw">
                Withdraw consent
              </button>
            </form>
          ) : null}
          {!child.mayConsent ? (
            <p data-testid="cannot-consent">
              Another guardian of {child.student.givenName} decides on consent.
            </p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
