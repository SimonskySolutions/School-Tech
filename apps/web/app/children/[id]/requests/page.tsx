import Link from 'next/link';
import { redirect } from 'next/navigation';
import { REQUEST_KINDS } from '@pythagoras/shared';
import { fetchStudentRequests } from '../../../../lib/api-client';
import { KIND_LABELS, REQUEST_NOTICES, STATUS_LABELS } from '../../../../lib/requests';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Sofia',
  }).format(new Date(iso));

/** A guardian writes to the child's school and follows the replies (M4.7). */
export default async function ChildRequestsPage({
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
  const result = await fetchStudentRequests(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Messages to the school</h1>
        <p data-testid="not-permitted">This child is not linked to your account.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const child = result.value;
  const done = typeof query.done === 'string' ? (REQUEST_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const action = `/children/${child.student.id}/requests/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Messages to the school: ${child.student.givenName} ${child.student.familyName}`}</h1>
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
        For allergies and diets, record them on the{' '}
        <Link href={`/children/${child.student.id}/dietary`}>dietary page</Link> as well, so the kitchen sees
        them. In an emergency, always call the school.
      </p>

      {child.schools.length ? (
        <section aria-labelledby="new" data-testid="new-request">
          <h2 id="new">New message</h2>
          <form method="post" action={action} style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem' }}>
            <input type="hidden" name="action" value="open" />
            {child.schools.length === 1 ? (
              <input type="hidden" name="school_id" value={child.schools[0]!.id} />
            ) : (
              <label>
                School{' '}
                <select name="school_id">
                  {child.schools.map((school) => (
                    <option key={school.id} value={school.id}>
                      {school.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              About{' '}
              <select name="kind" defaultValue="question">
                {REQUEST_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject <input name="subject" required maxLength={200} />
            </label>
            <label>
              Message <textarea name="message" required rows={4} maxLength={4000} />
            </label>
            <button type="submit" data-testid="send-request">
              Send to the school
            </button>
          </form>
        </section>
      ) : (
        <p>{child.student.givenName} has no current school to write to.</p>
      )}

      <section aria-labelledby="earlier" data-testid="requests">
        <h2 id="earlier">Messages</h2>
        {child.requests.length === 0 ? <p>None yet.</p> : null}
        {child.requests.map((request) => (
          <article
            key={request.id}
            data-testid={`request-${request.id}`}
            style={{
              border: '1px solid #ccc',
              borderRadius: 4,
              padding: '0 1rem 1rem',
              marginBottom: '1rem',
            }}
          >
            <h3>{`${KIND_LABELS[request.kind]}: ${request.subject}`}</h3>
            <p data-testid="status">{`${request.school.name} · ${STATUS_LABELS[request.status]}`}</p>
            <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
              {request.messages.map((message, index) => (
                <li key={index} style={{ marginBottom: '0.5rem' }}>
                  <strong>{message.fromSchool ? request.school.name : (message.authorName ?? 'You')}</strong>
                  {`, ${when(message.createdAt)}: ${message.body}`}
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
                    Reply <textarea name="message" required rows={2} maxLength={4000} />
                  </label>
                  <button type="submit">Send</button>
                </form>
                <form method="post" action={action} style={{ marginTop: '0.5rem' }}>
                  <input type="hidden" name="action" value="close" />
                  <input type="hidden" name="request_id" value={request.id} />
                  <button type="submit" data-testid="close-request">
                    Close (no more to say)
                  </button>
                </form>
              </>
            ) : null}
          </article>
        ))}
      </section>
    </main>
  );
}
