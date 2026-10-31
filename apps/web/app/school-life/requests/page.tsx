import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolRequests } from '../../../lib/api-client';
import { KIND_LABELS, REQUEST_NOTICES, STATUS_LABELS } from '../../../lib/requests';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTERS = ['active', 'open', 'in_progress', 'answered', 'closed'] as const;
const FILTER_LABELS: Record<(typeof FILTERS)[number], string> = {
  active: 'Not closed',
  open: 'Waiting',
  in_progress: 'Being worked on',
  answered: 'Answered',
  closed: 'Closed',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Sofia',
  }).format(new Date(iso));

/** Families' requests at the schools where the viewer handles them, waiting ones first (M4.7). */
export default async function RequestsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const filter = FILTERS.find((value) => value === params.status) ?? 'active';
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolRequests(config.API_INTERNAL_URL, session.accessToken, filter);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Families&apos; requests</h1>
        <p data-testid="not-permitted">This page is for School Life and school leaders.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof params.done === 'string' ? (REQUEST_NOTICES[params.done] ?? null) : null;
  const error = typeof params.error === 'string' ? params.error : null;
  const action = '/school-life/requests/actions';

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Families&apos; requests</h1>
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
              <Link href={`/school-life/requests?status=${value}`}>{FILTER_LABELS[value]}</Link>
            )}
          </span>
        ))}
      </p>
      {view.requests.length === 0 ? <p>No requests here.</p> : null}
      {view.requests.map((request) => (
        <article
          key={request.id}
          data-testid={`request-${request.id}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2>{`${KIND_LABELS[request.kind]}: ${request.subject}`}</h2>
          <p>
            {[
              `${request.studentName ?? 'A child'}${request.classLabel ? `, ${request.classLabel}` : ''}`,
              request.school.name,
              request.requestedBy ? `from ${request.requestedBy}` : null,
              STATUS_LABELS[request.status],
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
            {request.messages.map((message, index) => (
              <li key={index} style={{ marginBottom: '0.5rem' }}>
                <strong>
                  {message.authorName ?? (message.fromSchool ? request.school.name : 'The family')}
                </strong>
                {`${message.fromSchool ? ' (school)' : ''}, ${when(message.createdAt)}: ${message.body}`}
              </li>
            ))}
          </ul>
          {request.status !== 'closed' ? (
            <>
              <form
                method="post"
                action={action}
                style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem' }}
              >
                <input type="hidden" name="action" value="reply" />
                <input type="hidden" name="request_id" value={request.id} />
                <label>
                  Answer <textarea name="message" required rows={2} maxLength={4000} />
                </label>
                <button type="submit" data-testid="answer">
                  Send the answer
                </button>
              </form>
              <div style={{ marginTop: '0.5rem' }}>
                {request.status === 'open' ? (
                  <form method="post" action={action} style={{ display: 'inline' }}>
                    <input type="hidden" name="action" value="take" />
                    <input type="hidden" name="request_id" value={request.id} />
                    <button type="submit" data-testid="take">
                      Working on it
                    </button>
                  </form>
                ) : null}{' '}
                <form method="post" action={action} style={{ display: 'inline' }}>
                  <input type="hidden" name="action" value="close" />
                  <input type="hidden" name="request_id" value={request.id} />
                  <button type="submit">Close</button>
                </form>
              </div>
            </>
          ) : null}
        </article>
      ))}
    </main>
  );
}
