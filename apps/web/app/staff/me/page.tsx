import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchMyEmployments } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';
import { TRAINING_KINDS } from '@pythagoras/shared';
import {
  CONTRACT_LABELS,
  hoursLabel,
  QUALIFICATION_LABELS,
  STAFF_DONE,
  STATE_LABELS,
  TRAINING_LABELS,
  TRAINING_STATUS_LABELS,
  workingTimeLabel,
} from '../../../lib/staff';
import { CATEGORY_LABELS, sizeLabel } from '../../../lib/documents';
import { DevelopmentBanner } from '../../development-banner';
import { DownloadButton } from '../../documents/download-button';

export const dynamic = 'force-dynamic';

/** A member of staff's own employment records, qualifications and check (M6.1, M6.2, ADR 0028). */
export default async function MyEmploymentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const done = typeof query.done === 'string' ? (STAFF_DONE[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchMyEmployments(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  const records =
    result.kind === 'ok'
      ? result.value
      : {
          employments: [],
          qualifications: [],
          recordCheck: null,
          training: [],
          schoolYear: '',
          documents: [],
        };
  const action = '/staff/me/actions';
  const employments = records.employments;
  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>My employment</h1>
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
      {employments.length === 0 ? <p data-testid="none">No employment is recorded for you.</p> : null}
      <ul data-testid="my-employments">
        {employments.map((employment) => (
          <li key={employment.id}>
            {`${employment.position} at ${employment.school?.name ?? 'the group'}, ${CONTRACT_LABELS[employment.contractKind].toLowerCase()}, ${workingTimeLabel(employment.workingTime)}, with ${employment.employer.name}, from ${employment.startDate}${employment.endDate ? ` to ${employment.endDate}` : ''}`}
          </li>
        ))}
      </ul>
      <h2>Qualifications</h2>
      {records.qualifications.length === 0 ? <p>None recorded.</p> : null}
      <ul data-testid="my-qualifications">
        {records.qualifications.map((qualification) => (
          <li key={qualification.id}>
            {`${QUALIFICATION_LABELS[qualification.kind]}: ${qualification.title}, from ${qualification.awardedOn}${qualification.expiresOn ? ` until ${qualification.expiresOn} (${STATE_LABELS[qualification.state]})` : ''}`}
          </li>
        ))}
      </ul>
      <h2>Criminal record check</h2>
      <p data-testid="my-check">
        {records.recordCheck
          ? `Certificate seen ${records.recordCheck.seenOn}, valid until ${records.recordCheck.validUntil} (${STATE_LABELS[records.recordCheck.state]}).`
          : 'None recorded.'}
      </p>
      <h2>{`Professional development (this year ${records.schoolYear})`}</h2>
      {records.training.length === 0 ? <p>None recorded.</p> : null}
      <ul data-testid="my-training">
        {records.training.map((training) => (
          <li key={training.id}>
            {`${training.schoolYear}: ${TRAINING_LABELS[training.kind]}: ${training.title}${training.provider ? `, ${training.provider}` : ''}, ${training.startsOn}${training.endsOn !== training.startsOn ? ` to ${training.endsOn}` : ''}, ${hoursLabel(training.hours)} (${TRAINING_STATUS_LABELS[training.status]})`}
            {training.status === 'planned' ? (
              <>
                <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                  <input type="hidden" name="action" value="training-attended" />
                  <input type="hidden" name="training_id" value={training.id} />
                  <button type="submit">Attended</button>
                </form>
                <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                  <input type="hidden" name="action" value="training-cancelled" />
                  <input type="hidden" name="training_id" value={training.id} />
                  <button type="submit">Cancelled</button>
                </form>
              </>
            ) : null}
          </li>
        ))}
      </ul>
      {records.employments.length > 0 ? (
        <details>
          <summary>Add training you attended or plan to attend</summary>
          <form
            method="post"
            action={action}
            style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem', marginTop: '0.5rem' }}
          >
            <input type="hidden" name="action" value="train" />

            <label>
              Training <input name="title" required maxLength={200} />
            </label>
            <label>
              By (optional) <input name="provider" maxLength={200} />
            </label>
            <label>
              Kind{' '}
              <select name="kind" defaultValue="course">
                {TRAINING_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {TRAINING_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From <input name="starts_on" type="date" required />
            </label>
            <label>
              To (if more than a day) <input name="ends_on" type="date" />
            </label>
            <label>
              Hours <input name="hours" type="number" min={0.5} max={500} step={0.5} required />
            </label>
            <label>
              <input type="radio" name="status" value="attended" defaultChecked /> Attended
            </label>
            <label>
              <input type="radio" name="status" value="planned" /> Planned
            </label>
            <button type="submit" data-testid="add-training">
              Add the training
            </button>
          </form>
        </details>
      ) : null}
      <h2>My documents</h2>
      {records.documents.length === 0 ? <p>None filed.</p> : null}
      <ul data-testid="my-documents">
        {records.documents.map((document) => {
          const latest = document.versions[0];
          return (
            <li key={document.id}>
              {`${CATEGORY_LABELS[document.category]}: ${document.title}`}
              {document.archivedAt ? ' (archived)' : ''}
              {latest ? (
                <>
                  {`, version ${latest.versionNo}, ${latest.fileName}, ${sizeLabel(latest.sizeBytes)}`}
                  <DownloadButton versionId={latest.id} back="/staff/me" label="Download" />
                </>
              ) : (
                ', no file yet'
              )}
            </li>
          );
        })}
      </ul>
      <p>If something here is wrong, ask your school&apos;s office to correct it.</p>
    </main>
  );
}
