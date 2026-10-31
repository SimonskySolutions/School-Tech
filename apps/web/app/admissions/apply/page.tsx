import Link from 'next/link';
import { redirect } from 'next/navigation';
import { APPLICATION_DONE, APPLICATION_STATUS_LABELS, isFinished } from '../../../lib/admissions';
import { fetchFamilyAdmissions } from '../../../lib/api-client';
import { formatDay } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const field = { display: 'grid', gap: '0.25rem' } as const;

/** The last day to answer: the offer runs to the end of it, school time. */
const answerBy = (expiresAt: string) =>
  new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Sofia',
  }).format(new Date(new Date(expiresAt).getTime() - 1000));

/**
 * A signed-in parent applies for a place (M5.2, ADR 0027): for one of their
 * children or for a child the group does not know yet, and follows their own
 * applications.
 */
export default async function ApplyPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchFamilyAdmissions(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Apply for a place</h1>
        <p data-testid="unavailable">Applications cannot be shown just now. Please try again later.</p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof params.done === 'string' ? (APPLICATION_DONE[params.done] ?? null) : null;
  const error = typeof params.error === 'string' ? params.error : null;
  const action = '/admissions/apply/actions';
  const taking = view.intakes.filter((intake) => intake.takingApplications);

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Apply for a place</h1>
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

      <section aria-labelledby="mine" data-testid="my-applications">
        <h2 id="mine">Your applications</h2>
        {view.applications.length === 0 ? <p>You have not applied yet.</p> : null}
        <ul>
          {view.applications.map((application) => (
            <li key={application.id} data-testid={`application-${application.id}`}>
              {`${application.childName ?? 'Your child'}: ${application.school.name}, grade ${application.intake.grade}, ${application.intake.schoolYear} · ${APPLICATION_STATUS_LABELS[application.status]}${application.offerExpiresAt ? `, answer by ${answerBy(application.offerExpiresAt)}` : ''}${application.waitlistPosition ? ` (number ${application.waitlistPosition})` : ''}`}
              {application.status === 'offered' ? (
                <>
                  <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                    <input type="hidden" name="action" value="accept" />
                    <input type="hidden" name="application_id" value={application.id} />
                    <button type="submit" data-testid="accept">
                      Accept the place
                    </button>
                  </form>
                  <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                    <input type="hidden" name="action" value="decline" />
                    <input type="hidden" name="application_id" value={application.id} />
                    <button type="submit" data-testid="decline">
                      Decline
                    </button>
                  </form>
                </>
              ) : null}
              {!isFinished(application.status) ? (
                <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                  <input type="hidden" name="action" value="withdraw" />
                  <input type="hidden" name="application_id" value={application.id} />
                  <button type="submit" data-testid="withdraw">
                    Withdraw
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="intakes" data-testid="intakes">
        <h2 id="intakes">Places you can apply for</h2>
        {view.intakes.length === 0 ? <p>No school is taking applications just now.</p> : null}
        <ul>
          {view.intakes.map((intake) => (
            <li key={intake.id}>
              {`${intake.school.name}, grade ${intake.grade}, ${intake.schoolYear}: ${intake.places} places · applications ${intake.takingApplications ? `until ${formatDay(intake.closesOn)}` : `from ${formatDay(intake.opensOn)}`}`}
            </li>
          ))}
        </ul>
      </section>

      {taking.length > 0 && view.notice ? (
        <section aria-labelledby="apply" data-testid="apply">
          <h2 id="apply">Apply</h2>
          <form method="post" action={action} style={{ display: 'grid', gap: '0.75rem', maxWidth: '36rem' }}>
            <input type="hidden" name="action" value="apply" />
            <input type="hidden" name="notice_id" value={view.notice.id} />
            <label style={field}>
              School and grade
              <select name="intake_id" required defaultValue={taking.length === 1 ? taking[0]!.id : ''}>
                {taking.length > 1 ? (
                  <option value="" disabled>
                    Choose
                  </option>
                ) : null}
                {taking.map((intake) => (
                  <option key={intake.id} value={intake.id}>
                    {`${intake.school.name}, grade ${intake.grade}, ${intake.schoolYear}`}
                  </option>
                ))}
              </select>
            </label>
            <label style={field}>
              Child
              <select name="child" required defaultValue={view.children.length ? '' : 'new'}>
                {view.children.length ? (
                  <option value="" disabled>
                    Choose
                  </option>
                ) : null}
                {view.children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
                <option value="new">A child not yet at our schools</option>
              </select>
            </label>
            <fieldset style={{ display: 'grid', gap: '0.5rem' }}>
              <legend>For a child not yet at our schools</legend>
              <label style={field}>
                First name <input name="child_given_name" maxLength={100} />
              </label>
              <label style={field}>
                Family name <input name="child_family_name" maxLength={100} />
              </label>
              <label style={field}>
                Date of birth <input name="child_birth_date" type="date" />
              </label>
              <label style={field}>
                Current school or kindergarten (optional) <input name="current_school" maxLength={200} />
              </label>
            </fieldset>
            <label style={field}>
              Anything the school should know (optional)
              <textarea name="message" rows={3} maxLength={2000} />
            </label>
            <section aria-labelledby="notice" data-testid="privacy-notice">
              <h3
                id="notice"
                style={{ fontSize: '1rem' }}
              >{`How we use what you send (version ${view.notice.version})`}</h3>
              <p style={{ whiteSpace: 'pre-line' }}>{view.notice.text}</p>
            </section>
            <label>
              <input type="checkbox" name="notice_read" value="yes" required /> I have read how these details
              are used.
            </label>
            <button type="submit" data-testid="send-application">
              Send the application
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
