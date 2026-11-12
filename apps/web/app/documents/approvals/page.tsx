import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchMyApprovals } from '../../../lib/api-client';
import { APPROVER_LABELS, approvalLabel, CATEGORY_LABELS, DOCUMENTS_DONE } from '../../../lib/documents';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';
import { DecideStep } from '../approval-controls';
import { DownloadButton } from '../download-button';

export const dynamic = 'force-dynamic';

/** Approval steps waiting for the signed-in person, the oldest request first (M6.5). */
export default async function MyApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchMyApprovals(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  const waiting = result.kind === 'ok' ? result.value.waiting : [];
  const done = typeof query.done === 'string' ? (DOCUMENTS_DONE[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const back = '/documents/approvals';

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Approvals</h1>
      <p>
        Documents waiting for your approval. Read the version before you decide: an approved version never
        changes.
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
      {waiting.length === 0 ? <p data-testid="nothing-waiting">Nothing is waiting for you.</p> : null}
      <ul data-testid="waiting">
        {waiting.map((entry) => (
          <li key={entry.stepId} data-testid={`waiting-${entry.stepId}`}>
            <strong>{entry.title}</strong>
            {` · ${[
              CATEGORY_LABELS[entry.category],
              entry.schoolName,
              entry.personName,
              `version ${entry.versionNo}: ${entry.fileName}`,
              `asked ${entry.requestedAt.slice(0, 10)}`,
              `step ${entry.stepNo} of ${entry.steps.length}, as ${APPROVER_LABELS[entry.role]}`,
            ]
              .filter(Boolean)
              .join(' · ')}`}
            <DownloadButton versionId={entry.versionId} back={back} label="Download to read" />
            <p style={{ margin: '0.25rem 0' }}>
              {approvalLabel({
                id: entry.requestId,
                status: 'pending',
                requestedAt: entry.requestedAt,
                decidedAt: null,
                steps: entry.steps,
              })}
            </p>
            <DecideStep step={entry.steps.find((step) => step.id === entry.stepId)!} back={back} />
            {entry.schoolId ? (
              <p style={{ margin: '0.25rem 0' }}>
                <Link href={`/schools/${entry.schoolId}/documents`}>{`${entry.schoolName}'s documents`}</Link>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </main>
  );
}
