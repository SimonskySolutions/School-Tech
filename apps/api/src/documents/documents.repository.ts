import {
  type DocumentAttachedTo,
  type DocumentCategory,
  type DocumentContentType,
  type DocumentRequestBody,
  type DocumentSummary,
  type DocumentVersion,
  type SchoolDocuments,
  type SchoolId,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';
import { approvalsOf } from './approvals.repository';

// Documents and their versions (M6.4, ADR 0029). Row-level security decides
// what the signed-in person sees; every write goes through the documents.*
// functions, which check who may file what.

export class DocumentRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 413 | 415 | 422 | 503,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [DocumentRejected['status'], string]> = {
  P0002: [404, 'no such document here'],
  '42501': [403, 'not permitted'],
  '23514': [422, 'a value is not allowed here'],
  PY001: [409, 'not possible in its present state'],
  '23505': [409, 'this version is already waiting for approval or approved'],
};

export async function refusalsAsDocuments<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new DocumentRejected(refusal[0], refusal[1]);
    throw error;
  }
}

interface DocumentRow {
  id: string;
  attached_to: DocumentAttachedTo;
  school_id: SchoolId | null;
  person_id: string | null;
  person_name: string | null;
  title: string;
  category: DocumentCategory;
  for_all_staff: boolean;
  created_at: Date;
  archived_at: Date | null;
  can_manage: boolean;
}

interface VersionRow {
  id: string;
  document_id: string;
  version_no: number;
  file_name: string;
  content_type: DocumentContentType;
  size_bytes: string;
  uploaded_at: Date;
}

const DOCUMENT_SELECT = `
  SELECT d.id, d.attached_to, d.school_id, d.person_id,
         CASE WHEN p.id IS NOT NULL THEN p.given_name || ' ' || p.family_name END AS person_name,
         d.title, d.category, d.for_all_staff, d.created_at, d.archived_at,
         documents.may('manage', d.attached_to, d.school_id, d.person_id, d.for_all_staff) AS can_manage
    FROM documents.document d
    LEFT JOIN people.person p ON p.id = d.person_id`;

async function withVersions(tx: PersonTransaction, rows: DocumentRow[]): Promise<DocumentSummary[]> {
  const versions = await tx.query<VersionRow>(
    `SELECT id, document_id, version_no, file_name, content_type, size_bytes, uploaded_at
       FROM documents.version WHERE document_id = ANY($1::uuid[]) ORDER BY version_no DESC`,
    [rows.map((row) => row.id)],
  );
  const approvals = await approvalsOf(
    tx,
    versions.map((version) => version.id),
  );
  const byDocument = new Map<string, DocumentVersion[]>();
  for (const version of versions) {
    const list = byDocument.get(version.document_id) ?? [];
    list.push({
      id: version.id,
      versionNo: version.version_no,
      fileName: version.file_name,
      contentType: version.content_type,
      sizeBytes: Number(version.size_bytes),
      uploadedAt: version.uploaded_at.toISOString(),
      approval: approvals.get(version.id) ?? null,
    });
    byDocument.set(version.document_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    attachedTo: row.attached_to,
    schoolId: row.school_id,
    personId: row.person_id,
    personName: row.person_name,
    title: row.title,
    category: row.category,
    forAllStaff: row.for_all_staff,
    createdAt: row.created_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
    canManage: row.can_manage,
    versions: byDocument.get(row.id) ?? [],
  }));
}

/**
 * A school's documents, its students' and those of the staff working there
 * now, as far as the reader may see them; null when the reader has nothing to
 * do with the school's documents.
 */
export async function schoolDocuments(
  tx: PersonTransaction,
  schoolId: string,
): Promise<SchoolDocuments | null> {
  const [school] = await tx.query<{ id: SchoolId; name: string; can_manage: boolean; may_open: boolean }>(
    `SELECT s.id, s.name,
            documents.may('manage', 'school', s.id, NULL, false) AS can_manage,
            documents.may('read', 'school', s.id, NULL, true) AS may_open
       FROM org.school s WHERE s.id = $1`,
    [schoolId],
  );
  if (!school?.may_open) return null;
  const staff = await tx.query<{ person_id: string; given_name: string; family_name: string }>(
    `SELECT DISTINCT person_id, given_name, family_name FROM staff.school_staff($1)
      ORDER BY family_name, given_name`,
    [schoolId],
  );
  const students = school.can_manage
    ? await tx.query<{ person_id: string; given_name: string; family_name: string }>(
        `SELECT DISTINCT p.id AS person_id, p.given_name, p.family_name
           FROM people.enrolment e JOIN people.person p ON p.id = e.student_person_id
          WHERE e.school_id = $1 AND e.status IN ('active', 'suspended')
            AND (e.end_date IS NULL OR e.end_date > current_date)
          ORDER BY p.family_name, p.given_name`,
        [schoolId],
      )
    : [];
  const rows = await tx.query<DocumentRow>(
    `${DOCUMENT_SELECT}
      WHERE d.school_id = $1 OR (d.attached_to = 'staff' AND d.person_id = ANY($2::uuid[]))
      ORDER BY d.archived_at IS NOT NULL, d.attached_to, d.title, d.created_at`,
    [schoolId, staff.map((person) => person.person_id)],
  );
  const name = (person: { given_name: string; family_name: string }) =>
    `${person.given_name} ${person.family_name}`;
  return {
    school: { id: school.id, name: school.name },
    canManage: school.can_manage,
    documents: await withVersions(tx, rows),
    staff: staff.map((person) => ({ personId: person.person_id, name: name(person) })),
    students: students.map((person) => ({ personId: person.person_id, name: name(person) })),
  };
}

/** The signed-in person's own staff documents. */
export async function myDocuments(tx: PersonTransaction): Promise<DocumentSummary[]> {
  const rows = await tx.query<DocumentRow>(
    `${DOCUMENT_SELECT}
      WHERE d.attached_to = 'staff' AND d.person_id = app.current_person_id()
      ORDER BY d.created_at DESC`,
  );
  return withVersions(tx, rows);
}

export async function createDocument(
  tx: PersonTransaction,
  body: DocumentRequestBody,
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    'SELECT documents.create_document($1, $2, $3, $4, $5, $6) AS id',
    [
      body.attachedTo,
      body.schoolId ?? null,
      body.personId ?? null,
      body.title,
      body.category,
      body.forAllStaff ?? false,
    ],
  );
  if (!row) throw new DocumentRejected(404, 'no such document here');
  return row;
}

export interface NewVersion {
  fileName: string;
  contentType: DocumentContentType;
  sizeBytes: number;
  sha256: Buffer;
}

export async function addVersion(
  tx: PersonTransaction,
  documentId: string,
  version: NewVersion,
): Promise<{ versionId: string; versionNo: number; objectKey: string }> {
  const [row] = await tx.query<{ version_id: string; version_no: number; object_key: string }>(
    'SELECT version_id, version_no, object_key FROM documents.add_version($1, $2, $3, $4, $5)',
    [documentId, version.fileName, version.contentType, version.sizeBytes, version.sha256],
  );
  if (!row) throw new DocumentRejected(404, 'no such document here');
  return { versionId: row.version_id, versionNo: row.version_no, objectKey: row.object_key };
}

export async function archiveDocument(
  tx: PersonTransaction,
  documentId: string,
): Promise<{ archived: true }> {
  await tx.query('SELECT documents.archive_document($1)', [documentId]);
  return { archived: true };
}

export async function issueLink(tx: PersonTransaction, versionId: string, tokenHash: Buffer): Promise<Date> {
  const [row] = await tx.query<{ expires_at: Date }>('SELECT documents.issue_link($1, $2) AS expires_at', [
    versionId,
    tokenHash,
  ]);
  if (!row) throw new DocumentRejected(404, 'no such document here');
  return row.expires_at;
}

export interface RedeemedFile {
  versionId: string;
  objectKey: string;
  fileName: string;
  contentType: DocumentContentType;
  sizeBytes: number;
}

/** Uses the link once, for the person it was issued to; the access log gets the download. */
export async function redeemLink(tx: PersonTransaction, tokenHash: Buffer): Promise<RedeemedFile> {
  const [row] = await tx.query<{
    version_id: string;
    object_key: string;
    file_name: string;
    content_type: DocumentContentType;
    size_bytes: string;
  }>('SELECT version_id, object_key, file_name, content_type, size_bytes FROM documents.redeem_link($1)', [
    tokenHash,
  ]);
  if (!row) throw new DocumentRejected(404, 'the link has expired or been used');
  return {
    versionId: row.version_id,
    objectKey: row.object_key,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
  };
}
