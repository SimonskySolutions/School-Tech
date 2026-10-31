import Link from 'next/link';
import { redirect } from 'next/navigation';
import { APPLICATION_NOTE_KINDS } from '@pythagoras/shared';
import {
  APPLICATION_DONE,
  APPLICATION_NOTE_LABELS,
  APPLICATION_STATUS_LABELS,
  isFinished,
} from '../../../lib/admissions';
import { fetchSchoolApplications } from '../../../lib/api-client';
import { formatDay } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Sofia' }).format(
    new Date(iso),
  );

/** Intakes and applications at the schools where the viewer works on admissions (M5.2). */
export default async function ApplicationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const intakeId = typeof params.intakeId === 'string' && UUID.test(params.intakeId) ? params.intakeId : null;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolApplications(config.API_INTERNAL_URL, session.accessToken, intakeId);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Applications</h1>
        <p data-testid="not-permitted">This page is for each school&apos;s admissions staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof params.done === 'string' ? (APPLICATION_DONE[params.done] ?? null) : null;
  const error = typeof params.error === 'string' ? params.error : null;
  const action = '/admissions/applications/actions';
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/admissions/inquiries">Inquiries</Link>
      </p>
      <h1>Applications</h1>
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

      <section aria-labelledby="intakes" data-testid="intakes">
        <h2 id="intakes">Intakes</h2>
        {view.intakes.length === 0 ? <p>No intakes yet.</p> : null}
        <ul>
          {view.intakes.map((intake) => (
            <li key={intake.id} data-testid={`intake-${intake.id}`}>
              <Link href={`/admissions/applications?intakeId=${intake.id}`}>
                {`${intake.school.name}, grade ${intake.grade}, ${intake.schoolYear}`}
              </Link>
              {`: ${intake.places} places, ${intake.free} free · ${intake.applications.live} applications, ${intake.applications.offered} offered, ${intake.applications.accepted} accepted, ${intake.applications.waitlisted} waiting · ${intake.status === 'open' ? `open ${formatDay(intake.opensOn)} to ${formatDay(intake.closesOn)}` : 'closed'}`}
              {intake.status === 'open' ? (
                <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                  <input type="hidden" name="action" value="close-intake" />
                  <input type="hidden" name="intake_id" value={intake.id} />
                  <button type="submit">Close</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
        {view.schools.length > 0 ? (
          <form method="post" action={action} style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem' }}>
            <input type="hidden" name="action" value="open-intake" />
            <label>
              School{' '}
              <select name="school_id" required defaultValue={view.schools[0]!.id}>
                {view.schools.map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              School year{' '}
              <input name="school_year" required placeholder="2027/28" pattern="[0-9]{4}/[0-9]{2}" />
            </label>
            <label>
              Grade <input name="grade" required maxLength={20} />
            </label>
            <label>
              Places <input name="places" type="number" min={1} max={1000} required />
            </label>
            <label>
              Applications from <input name="opens_on" type="date" required defaultValue={today} />
            </label>
            <label>
              until <input name="closes_on" type="date" required />
            </label>
            <button type="submit" data-testid="open-intake">
              Open the intake
            </button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="applications" data-testid="applications">
        <h2 id="applications">{intakeId ? 'Applications for this intake' : 'All applications'}</h2>
        {intakeId ? (
          <p>
            <Link href="/admissions/applications">Show all</Link>
          </p>
        ) : null}
        {view.applications.length === 0 ? <p>No applications here.</p> : null}
        {view.applications.map((application) => (
          <article
            key={application.id}
            data-testid={`application-${application.id}`}
            style={{
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: '0 1rem 1rem',
              marginBottom: '1rem',
            }}
          >
            <h3>{application.child.name ?? 'Erased application'}</h3>
            <p>
              {[
                `${application.school.name}, grade ${application.intake.grade}, ${application.intake.schoolYear}`,
                APPLICATION_STATUS_LABELS[application.status],
                `sent ${when(application.submittedAt)}`,
                `notice version ${application.noticeVersion}`,
              ].join(' · ')}
            </p>
            <ul>
              {application.child.birthDate ? <li>{`Born ${application.child.birthDate}`}</li> : null}
              <li>{application.child.known ? 'Already at one of our schools' : 'New to our schools'}</li>
              {application.child.currentSchool ? (
                <li>{`Now at: ${application.child.currentSchool}`}</li>
              ) : null}
              <li>
                {`Parent: ${application.applicant.name ?? 'unknown'}${application.applicant.email ? `, ${application.applicant.email}` : ''}`}
              </li>
            </ul>
            {application.message ? <blockquote>{application.message}</blockquote> : null}
            {application.offerExpiresAt ? (
              <p>{`Offer open until ${new Date(application.offerExpiresAt).toLocaleString('en-GB', { timeZone: 'Europe/Sofia' })}`}</p>
            ) : null}
            {application.waitlistPosition ? (
              <p>{`Number ${application.waitlistPosition} on the waiting list`}</p>
            ) : null}
            {application.notes.length > 0 ? (
              <ul data-testid="application-notes">
                {application.notes.map((note, index) => (
                  <li key={index}>
                    {`${APPLICATION_NOTE_LABELS[note.kind]}${note.author ? `, ${note.author}` : ''}, ${when(note.createdAt)}: ${note.body ?? '(erased)'}`}
                  </li>
                ))}
              </ul>
            ) : null}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {application.status === 'submitted' ? (
                <form method="post" action={action}>
                  <input type="hidden" name="action" value="review" />
                  <input type="hidden" name="application_id" value={application.id} />
                  <button type="submit" data-testid="review">
                    Take into review
                  </button>
                </form>
              ) : null}
              {['submitted', 'under_review', 'waitlisted'].includes(application.status) ? (
                <>
                  <form method="post" action={action}>
                    <input type="hidden" name="action" value="offer" />
                    <input type="hidden" name="application_id" value={application.id} />
                    <label>
                      Answer by <input name="answer_by" type="date" required />
                    </label>{' '}
                    <button type="submit" data-testid="offer">
                      Offer a place
                    </button>
                  </form>
                  {application.status !== 'waitlisted' ? (
                    <form method="post" action={action}>
                      <input type="hidden" name="action" value="waitlist" />
                      <input type="hidden" name="application_id" value={application.id} />
                      <button type="submit" data-testid="waitlist">
                        Waiting list
                      </button>
                    </form>
                  ) : null}
                  <form method="post" action={action}>
                    <input type="hidden" name="action" value="reject" />
                    <input type="hidden" name="application_id" value={application.id} />
                    <button type="submit" data-testid="reject">
                      No place
                    </button>
                  </form>
                </>
              ) : null}
            </div>
            {!isFinished(application.status) ? (
              <form
                method="post"
                action={action}
                style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem', marginTop: '0.5rem' }}
              >
                <input type="hidden" name="action" value="note" />
                <input type="hidden" name="application_id" value={application.id} />
                <label>
                  Kind{' '}
                  <select name="kind" defaultValue="interview">
                    {APPLICATION_NOTE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {APPLICATION_NOTE_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Note (staff only) <textarea name="body" required rows={2} maxLength={4000} />
                </label>
                <button type="submit" data-testid="add-application-note">
                  Add the note
                </button>
              </form>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
