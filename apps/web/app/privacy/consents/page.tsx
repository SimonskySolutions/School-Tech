import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchConsentPurposes } from '../../../lib/api-client';
import { CONSENT_NOTICES } from '../../../lib/consents';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

/** The data protection officer publishes the wording families agree to (M6.6, ADR 0030). */
export default async function ConsentWordingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchConsentPurposes(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Consent wording</h1>
        <p data-testid="not-permitted">This page is for the data protection officer.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const done = typeof query.done === 'string' ? (CONSENT_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Consent wording</h1>
      <p>
        Families agree to the latest wording of each approved consent purpose. Published wording never
        changes. Tick &quot;ask families again&quot; when the new wording changes what is agreed: earlier
        consents then stop counting until each family agrees again.
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
      {result.value.purposes.map((purpose) => (
        <section
          key={purpose.purposeId}
          data-testid={`purpose-${purpose.code}`}
          aria-labelledby={`p-${purpose.purposeId}`}
        >
          <h2 id={`p-${purpose.purposeId}`}>{`${purpose.name} (${purpose.code})`}</h2>
          <p>{`${purpose.description}. ${purpose.status === 'approved' ? `${purpose.given} consents count now.` : `Not approved (${purpose.status}): families are not asked.`}`}</p>
          <ul>
            {purpose.wordings.map((wording) => (
              <li key={wording.id}>
                {`Version ${wording.version}, ${wording.publishedAt.slice(0, 10)}${wording.renewalRequired ? ', families asked again' : ''}: ${wording.text}`}
              </li>
            ))}
          </ul>
          {purpose.status === 'approved' ? (
            <details>
              <summary>Publish new wording</summary>
              <form
                method="post"
                action="/privacy/consents/actions"
                style={{ display: 'grid', gap: '0.5rem', maxWidth: '40rem' }}
              >
                <input type="hidden" name="purpose_id" value={purpose.purposeId} />
                <label>
                  Wording <textarea name="wording" required minLength={20} maxLength={4000} rows={5} />
                </label>
                <label>
                  <input type="checkbox" name="renewal_required" value="yes" /> It changes what is agreed: ask
                  families again
                </label>
                <button type="submit">Publish</button>
              </form>
            </details>
          ) : null}
        </section>
      ))}
    </main>
  );
}
