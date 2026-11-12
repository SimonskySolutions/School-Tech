import { type DocumentAttachedTo, type DocumentSummary, DOCUMENT_CATEGORIES } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolDocuments } from '../../../../lib/api-client';
import {
  ACCEPT,
  ATTACHED_LABELS,
  CATEGORY_LABELS,
  DOCUMENTS_DONE,
  sizeLabel,
  TYPE_LABELS,
} from '../../../../lib/documents';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';
import { ApprovalControls } from '../../../documents/approval-controls';
import { DownloadButton } from '../../../documents/download-button';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const GROUPS: DocumentAttachedTo[] = ['school', 'staff', 'student'];
const inline = { display: 'inline', marginLeft: '0.5rem' } as const;
const grid = { display: 'grid', gap: '0.5rem', maxWidth: '36rem', marginTop: '0.5rem' } as const;

function DocumentEntry({
  document,
  action,
  back,
}: {
  document: DocumentSummary;
  action: string;
  back: string;
}) {
  const [latest, ...earlier] = document.versions;
  const about = [
    CATEGORY_LABELS[document.category],
    document.personName,
    document.forAllStaff ? 'for all staff' : null,
    document.archivedAt ? `archived ${document.archivedAt.slice(0, 10)}` : null,
    latest
      ? `version ${latest.versionNo}: ${latest.fileName}, ${TYPE_LABELS[latest.contentType]}, ${sizeLabel(latest.sizeBytes)}, ${latest.uploadedAt.slice(0, 10)}`
      : 'no file yet',
  ].filter(Boolean);
  return (
    <li data-testid={`document-${document.id}`}>
      <strong>{document.title}</strong>
      {` · ${about.join(' · ')}`}
      {latest ? <DownloadButton versionId={latest.id} back={back} label="Download" /> : null}
      {latest ? (
        <ApprovalControls
          approval={latest.approval}
          versionId={latest.id}
          attachedTo={document.attachedTo}
          canAsk={document.canManage && !document.archivedAt}
          canManage={document.canManage}
          back={back}
        />
      ) : null}
      {earlier.length > 0 ? (
        <details>
          <summary>Earlier versions</summary>
          <ul>
            {earlier.map((version) => (
              <li key={version.id}>
                {`Version ${version.versionNo}: ${version.fileName}, ${sizeLabel(version.sizeBytes)}, ${version.uploadedAt.slice(0, 10)}${version.approval?.status === 'approved' ? ', approved' : ''}`}
                <DownloadButton versionId={version.id} back={back} label="Download" />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {document.canManage && !document.archivedAt ? (
        <>
          <form method="post" action={action} encType="multipart/form-data" style={inline}>
            <input type="hidden" name="action" value="version" />
            <input type="hidden" name="document_id" value={document.id} />
            <input type="file" name="file" accept={ACCEPT} required aria-label="New version" />
            <button type="submit">Upload a new version</button>
          </form>
          <form method="post" action={action} style={inline}>
            <input type="hidden" name="action" value="archive" />
            <input type="hidden" name="document_id" value={document.id} />
            <button type="submit">Archive</button>
          </form>
        </>
      ) : null}
    </li>
  );
}

/** A school's private documents, its staff's and its pupils' (M6.4, ADR 0029). */
export default async function DocumentsPage({
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
  const result = await fetchSchoolDocuments(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Documents</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (DOCUMENTS_DONE[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const action = `/schools/${view.school.id}/documents/actions`;
  const back = `/schools/${view.school.id}/documents`;
  const current = view.documents.filter((document) => !document.archivedAt);
  const archived = view.documents.filter((document) => document.archivedAt);

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Documents at ${view.school.name}`}</h1>
      <p>
        Private: every file is downloaded through a link for you alone that lasts two minutes, and every
        download is recorded. Health and dietary information belongs in the dietary records, not here.
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
      {GROUPS.map((group) => {
        const documents = current.filter((document) => document.attachedTo === group);
        return (
          <section key={group} aria-labelledby={`documents-${group}`} data-testid={`documents-${group}`}>
            <h2 id={`documents-${group}`}>{ATTACHED_LABELS[group]}</h2>
            {documents.length === 0 ? <p>None.</p> : null}
            <ul>
              {documents.map((document) => (
                <DocumentEntry key={document.id} document={document} action={action} back={back} />
              ))}
            </ul>
          </section>
        );
      })}
      {archived.length > 0 ? (
        <details data-testid="documents-archived">
          <summary>{`Archived (${archived.length})`}</summary>
          <ul>
            {archived.map((document) => (
              <DocumentEntry key={document.id} document={document} action={action} back={back} />
            ))}
          </ul>
        </details>
      ) : null}
      {view.canManage ? (
        <section aria-labelledby="file-document">
          <h2 id="file-document">File a document</h2>
          <form method="post" action={action} encType="multipart/form-data" style={grid}>
            <input type="hidden" name="action" value="file" />
            <label>
              Title <input name="title" required maxLength={200} />
            </label>
            <label>
              Kind{' '}
              <select name="category" defaultValue="policy">
                {DOCUMENT_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              About{' '}
              <select name="attached" defaultValue="school">
                <option value="school">The school</option>
                {view.staff.length > 0 ? (
                  <optgroup label="A member of staff">
                    {view.staff.map((person) => (
                      <option key={person.personId} value={`staff:${person.personId}`}>
                        {person.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
                {view.students.length > 0 ? (
                  <optgroup label="A pupil">
                    {view.students.map((person) => (
                      <option key={person.personId} value={`student:${person.personId}`}>
                        {person.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </label>
            <label>
              <input type="checkbox" name="for_all_staff" value="yes" /> A school document every member of
              staff may read
            </label>
            <label>
              File (at most 10 MB) <input type="file" name="file" accept={ACCEPT} required />
            </label>
            <button type="submit" data-testid="file-document">
              File the document
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
