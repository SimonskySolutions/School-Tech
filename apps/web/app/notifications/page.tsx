import { type MessageStatus } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchMyNotifications } from '../../lib/api-client';
import { currentSession, runtime } from '../../lib/server';
import { DevelopmentBanner } from '../development-banner';

export const dynamic = 'force-dynamic';

const STATUS: Record<MessageStatus, string> = {
  queued: 'waiting to be sent',
  sending: 'being sent',
  sent: 'sent',
  skipped: 'not sent',
  failed: 'could not be sent',
};

const NOTICES: Record<string, string> = {
  on: 'You will receive these messages again.',
  off: 'You will not receive these messages any more.',
};

/** Which e-mails a person receives, and what was sent to them lately (M7.2, ADR 0031). */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchMyNotifications(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') redirect('/');
  const { kinds, recent } = result.value;
  const done = typeof query.done === 'string' ? (NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Notifications</h1>
      <p>
        We send e-mails to the address on your account. They say what happened and link here; you sign in to
        read the details. Messages marked &quot;always sent&quot; are about payments or your account and
        cannot be turned off.
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
      <ul data-testid="kinds">
        {kinds.map((kind) => (
          <li key={kind.code} data-testid={`kind-${kind.code}`}>
            {kind.description}
            {kind.essential ? (
              ' · always sent'
            ) : (
              <form
                method="post"
                action="/notifications/actions"
                style={{ display: 'inline', marginLeft: '0.5rem' }}
              >
                <input type="hidden" name="kind" value={kind.code} />
                <input type="hidden" name="enabled" value={kind.enabled ? 'false' : 'true'} />
                {` · ${kind.enabled ? 'on' : 'off'} `}
                <button type="submit">{kind.enabled ? 'Turn off' : 'Turn on'}</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <h2>Recent messages</h2>
      {recent.length === 0 ? <p>None yet.</p> : null}
      <ul data-testid="recent">
        {recent.map((message) => (
          <li key={message.id}>
            {`${message.createdAt.slice(0, 10)}: ${message.description} (${STATUS[message.status]})`}
          </li>
        ))}
      </ul>
    </main>
  );
}
