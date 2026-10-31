import { INQUIRY_NOTE_KINDS, INQUIRY_OUTCOMES } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { INQUIRY_DONE, NOTE_LABELS, OUTCOME_LABELS, splitName, STATUS_LABELS } from '../../../lib/admissions';
import { fetchSchoolInquiries } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTERS = ['open', 'closed', 'all'] as const;
const FILTER_LABELS: Record<(typeof FILTERS)[number], string> = {
  open: 'Open',
  closed: 'Closed',
  all: 'All',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Sofia',
  }).format(new Date(iso));

/** Inquiries from the websites of the schools where the viewer works on admissions (M5.1). */
export default async function InquiriesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = FILTERS.find((value) => value === params.status) ?? 'open';
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolInquiries(config.API_INTERNAL_URL, session.accessToken, filter);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Admissions inquiries</h1>
        <p data-testid="not-permitted">This page is for each school&apos;s admissions staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof params.done === 'string' ? (INQUIRY_DONE[params.done] ?? null) : null;
  const error = typeof params.error === 'string' ? params.error : null;
  const action = '/admissions/inquiries/actions';

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Admissions inquiries</h1>
      <p>
        Families who asked about a place on a school website. Use what they sent only to answer them; it is
        erased if no application follows.
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
      <p>
        {FILTERS.map((value, index) => (
          <span key={value}>
            {index ? ' · ' : ''}
            {value === filter ? (
              <strong>{FILTER_LABELS[value]}</strong>
            ) : (
              <Link href={`/admissions/inquiries?status=${value}`}>{FILTER_LABELS[value]}</Link>
            )}
          </span>
        ))}
      </p>
      {view.inquiries.length === 0 ? <p>No inquiries here.</p> : null}
      {view.inquiries.map((inquiry) => (
        <article
          key={inquiry.id}
          data-testid={`inquiry-${inquiry.id}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2>{inquiry.parentName ?? 'Erased inquiry'}</h2>
          <p>
            {[
              inquiry.school.name,
              STATUS_LABELS[inquiry.status] + (inquiry.outcome ? `: ${OUTCOME_LABELS[inquiry.outcome]}` : ''),
              `received ${when(inquiry.receivedAt)}`,
              `notice version ${inquiry.noticeVersion}`,
            ].join(' · ')}
          </p>
          <ul>
            {inquiry.email ? <li>{`E-mail: ${inquiry.email}`}</li> : null}
            {inquiry.phone ? <li>{`Telephone: ${inquiry.phone}`}</li> : null}
            {inquiry.childName || inquiry.birthYear ? (
              <li>
                {`Child: ${[inquiry.childName, inquiry.birthYear ? `born ${inquiry.birthYear}` : null].filter(Boolean).join(', ')}`}
              </li>
            ) : null}
            {inquiry.gradeOfInterest ? <li>{`Grade: ${inquiry.gradeOfInterest}`}</li> : null}
            {inquiry.intendedStart ? <li>{`Start: ${inquiry.intendedStart}`}</li> : null}
            <li>{inquiry.newsConsent ? 'Agreed to news about open days' : 'No news about open days'}</li>
          </ul>
          {inquiry.message ? <blockquote>{inquiry.message}</blockquote> : null}
          {inquiry.notes.length > 0 ? (
            <ul style={{ listStyle: 'none', paddingLeft: 0 }} data-testid="inquiry-log">
              {inquiry.notes.map((note, index) => (
                <li key={index} style={{ marginBottom: '0.5rem' }}>
                  {`${NOTE_LABELS[note.kind]}${note.author ? `, ${note.author}` : ''}, ${when(note.createdAt)}: ${note.body ?? '(erased)'}`}
                </li>
              ))}
            </ul>
          ) : null}
          {inquiry.invited ? (
            <p data-testid="invited">Invited to apply: the parent can sign in and apply.</p>
          ) : null}
          {inquiry.status !== 'closed' && !inquiry.invited && inquiry.email ? (
            <form method="post" action={action} style={{ marginBottom: '0.5rem' }}>
              <input type="hidden" name="action" value="invite" />
              <input type="hidden" name="inquiry_id" value={inquiry.id} />
              <label>
                First name{' '}
                <input
                  name="given_name"
                  required
                  maxLength={100}
                  defaultValue={splitName(inquiry.parentName).givenName}
                />
              </label>{' '}
              <label>
                Family name{' '}
                <input
                  name="family_name"
                  required
                  maxLength={100}
                  defaultValue={splitName(inquiry.parentName).familyName}
                />
              </label>{' '}
              <button type="submit" data-testid="invite">
                Invite to apply
              </button>
            </form>
          ) : null}
          {inquiry.status !== 'closed' ? (
            <>
              <form
                method="post"
                action={action}
                style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem' }}
              >
                <input type="hidden" name="action" value="note" />
                <input type="hidden" name="inquiry_id" value={inquiry.id} />
                <label>
                  Kind{' '}
                  <select name="kind" defaultValue="call">
                    {INQUIRY_NOTE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {NOTE_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  What happened <textarea name="body" required rows={2} maxLength={2000} />
                </label>
                <button type="submit" data-testid="add-note">
                  Add to the log
                </button>
              </form>
              <form method="post" action={action} style={{ marginTop: '0.5rem' }}>
                <input type="hidden" name="action" value="close" />
                <input type="hidden" name="inquiry_id" value={inquiry.id} />
                <label>
                  Outcome{' '}
                  <select name="outcome" defaultValue="applied">
                    {INQUIRY_OUTCOMES.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {OUTCOME_LABELS[outcome]}
                      </option>
                    ))}
                  </select>
                </label>{' '}
                <button type="submit" data-testid="close-inquiry">
                  Close
                </button>
              </form>
            </>
          ) : null}
        </article>
      ))}
    </main>
  );
}
