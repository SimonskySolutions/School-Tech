import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SENT_NOTICES, TRAP_FIELD } from '../../../lib/admissions';
import { lookUpInquiryForm, lookUpSite } from '../../../lib/cms';
import { runtime } from '../../../lib/server';
import { SITE_HOST_HEADER } from '../../../lib/sites';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export const metadata: Metadata = { title: 'Ask about a place' };

const field = { display: 'grid', gap: '0.25rem' } as const;

/**
 * The inquiry form of a school website (M5.1, ADR 0026): a family that does
 * not attend yet asks about a place. No sign-in; only the fields the notice
 * covers; the news consent is separate and unticked.
 */
export default async function InquiryPage({ searchParams }: { searchParams: SearchParams }) {
  const host = (await headers()).get(SITE_HOST_HEADER);
  if (!host) notFound();
  const params = await searchParams;
  const result = typeof params.result === 'string' && params.result in SENT_NOTICES ? params.result : null;
  const problem = typeof params.problem === 'string' ? params.problem.slice(0, 200) : null;

  const { config } = runtime();
  const [site, form] = await Promise.all([
    lookUpSite(config.API_INTERNAL_URL, host),
    lookUpInquiryForm(config.API_INTERNAL_URL, host),
  ]);
  if (site.kind === 'missing' || form.kind === 'missing') notFound();
  if (site.kind !== 'ok' || form.kind !== 'ok') {
    return (
      <main data-testid="site-unavailable">
        <h1>Ask about a place</h1>
        <p>The form is temporarily unavailable. Please try again in a few minutes.</p>
      </main>
    );
  }
  const { schools, notice } = form.value;

  return (
    <main lang={site.value.locale}>
      <DevelopmentBanner />
      <p style={{ fontWeight: 600, fontSize: '1.25rem', margin: 0 }}>
        <Link href="/">{site.value.name}</Link>
      </p>
      <h1>Ask about a place</h1>
      {result ? (
        <p role="status" data-testid="inquiry-result">
          {SENT_NOTICES[result as keyof typeof SENT_NOTICES]}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" data-testid="inquiry-problem">
          {`Please check the form: ${problem}.`}
        </p>
      ) : null}
      {result === 'sent' ? (
        <p>
          <Link href="/">Back to the website</Link>
        </p>
      ) : (
        <form
          method="post"
          action="/inquiry/send"
          style={{ display: 'grid', gap: '0.75rem', maxWidth: '36rem' }}
          data-testid="inquiry-form"
        >
          <input type="hidden" name="notice_id" value={notice.id} />
          {schools.length === 1 ? (
            <input type="hidden" name="school_id" value={schools[0]!.id} />
          ) : (
            <label style={field}>
              School
              <select name="school_id" required defaultValue="">
                <option value="" disabled>
                  Choose a school
                </option>
                {schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label style={field}>
            Your name
            <input name="parent_name" required maxLength={200} autoComplete="name" />
          </label>
          <label style={field}>
            E-mail
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <label style={field}>
            Telephone (optional)
            <input name="phone" type="tel" maxLength={20} autoComplete="tel" />
          </label>
          <label style={field}>
            Your child&apos;s first name (optional)
            <input name="child_name" maxLength={100} />
          </label>
          <label style={field}>
            Year of birth (optional)
            <input name="birth_year" inputMode="numeric" pattern="[0-9]{4}" maxLength={4} />
          </label>
          <label style={field}>
            Grade you are asking about (optional)
            <input name="grade" maxLength={20} />
          </label>
          <label style={field}>
            When you would like to start (optional)
            <input name="intended_start" maxLength={40} placeholder="e.g. September 2027" />
          </label>
          <label style={field}>
            Your question (optional)
            <textarea name="message" rows={4} maxLength={2000} />
          </label>
          {/* Left empty by people; anything here means a bot (ADR 0026). */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px' }}>
            <label>
              Leave this empty <input name={TRAP_FIELD} tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <section aria-labelledby="notice" data-testid="privacy-notice">
            <h2
              id="notice"
              style={{ fontSize: '1rem' }}
            >{`How we use what you send (version ${notice.version})`}</h2>
            <p style={{ whiteSpace: 'pre-line' }}>{notice.text}</p>
          </section>
          <label>
            <input type="checkbox" name="notice_read" value="yes" required /> I have read how my details are
            used.
          </label>
          <label>
            <input type="checkbox" name="news_consent" value="yes" /> {notice.newsConsentText}
          </label>
          <button type="submit">Send</button>
        </form>
      )}
    </main>
  );
}
