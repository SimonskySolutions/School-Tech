import {
  type Approval,
  type ApprovalStatus,
  type ApprovalStep,
  type ApprovalStepStatus,
  type ApproverRole,
  type DocumentAttachedTo,
  type DocumentCategory,
  type MyApprovals,
  type SchoolId,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Approvals of document versions (M6.5, ADR 0029): steps in order, each by a
// role; the functions documents.request_approval, decide_step and
// withdraw_approval decide who may do what. What the reader sees follows the
// document's row-level security.

interface RequestRow {
  id: string;
  version_id: string;
  status: ApprovalStatus;
  requested_at: Date;
  decided_at: Date | null;
}

interface StepRow {
  id: string;
  request_id: string;
  step_no: number;
  role_code: ApproverRole;
  status: ApprovalStepStatus;
  decided_by: string | null;
  decided_at: Date | null;
  note: string | null;
  may_decide: boolean;
}

// Whether the signed-in person may decide a step now: it is pending, every
// earlier step is approved, they hold its role and decided no other step.
const STEP_SELECT = `
  SELECT s.id, s.request_id, s.step_no, s.role_code, s.status, s.decided_at, s.note,
         documents.decided_by_name(s.id) AS decided_by,
         (s.status = 'pending' AND q.status = 'pending' AND d.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM documents.approval_step e
                           WHERE e.request_id = s.request_id AND e.step_no < s.step_no AND e.status <> 'approved')
          AND NOT EXISTS (SELECT 1 FROM documents.approval_step e
                           WHERE e.request_id = s.request_id AND e.decided_by_person_id = app.current_person_id())
          AND documents.holds_role(s.role_code, d.school_id)) AS may_decide
    FROM documents.approval_step s
    JOIN documents.approval_request q ON q.id = s.request_id
    JOIN documents.version v ON v.id = q.version_id
    JOIN documents.document d ON d.id = v.document_id`;

const stepOf = (row: StepRow): ApprovalStep => ({
  id: row.id,
  stepNo: row.step_no,
  role: row.role_code,
  status: row.status,
  decidedBy: row.decided_by,
  decidedAt: row.decided_at?.toISOString() ?? null,
  note: row.note,
  mayDecide: row.may_decide,
});

async function stepsOf(tx: PersonTransaction, requestIds: string[]): Promise<Map<string, ApprovalStep[]>> {
  const rows = await tx.query<StepRow>(
    `${STEP_SELECT} WHERE s.request_id = ANY($1::uuid[]) ORDER BY s.step_no`,
    [requestIds],
  );
  const byRequest = new Map<string, ApprovalStep[]>();
  for (const row of rows)
    byRequest.set(row.request_id, [...(byRequest.get(row.request_id) ?? []), stepOf(row)]);
  return byRequest;
}

/** The latest approval request of each version, by version id. */
export async function approvalsOf(
  tx: PersonTransaction,
  versionIds: string[],
): Promise<Map<string, Approval>> {
  const requests = await tx.query<RequestRow>(
    `SELECT DISTINCT ON (version_id) id, version_id, status, requested_at, decided_at
       FROM documents.approval_request WHERE version_id = ANY($1::uuid[])
      ORDER BY version_id, requested_at DESC, id DESC`,
    [versionIds],
  );
  const steps = await stepsOf(
    tx,
    requests.map((request) => request.id),
  );
  return new Map(
    requests.map((request) => [
      request.version_id,
      {
        id: request.id,
        status: request.status,
        requestedAt: request.requested_at.toISOString(),
        decidedAt: request.decided_at?.toISOString() ?? null,
        steps: steps.get(request.id) ?? [],
      },
    ]),
  );
}

export async function requestApproval(
  tx: PersonTransaction,
  versionId: string,
  roles: ApproverRole[],
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>('SELECT documents.request_approval($1, $2::text[]) AS id', [
    versionId,
    roles,
  ]);
  return { id: row!.id };
}

export async function decideStep(
  tx: PersonTransaction,
  stepId: string,
  decision: 'approved' | 'rejected',
  note: string | null,
): Promise<{ outcome: 'pending' | 'approved' | 'rejected' }> {
  const [row] = await tx.query<{ outcome: 'pending' | 'approved' | 'rejected' }>(
    'SELECT documents.decide_step($1, $2, $3) AS outcome',
    [stepId, decision, note],
  );
  return { outcome: row!.outcome };
}

export async function withdrawApproval(
  tx: PersonTransaction,
  requestId: string,
): Promise<{ withdrawn: true }> {
  await tx.query('SELECT documents.withdraw_approval($1)', [requestId]);
  return { withdrawn: true };
}

interface WaitingRow extends StepRow {
  requested_at: Date;
  document_id: string;
  title: string;
  category: DocumentCategory;
  attached_to: DocumentAttachedTo;
  school_id: SchoolId | null;
  school_name: string | null;
  person_name: string | null;
  version_id: string;
  version_no: number;
  file_name: string;
}

/** The steps waiting for the signed-in person, the oldest request first. */
export async function myApprovals(tx: PersonTransaction): Promise<MyApprovals> {
  const rows = await tx.query<WaitingRow>(
    `SELECT w.*, q.requested_at, d.id AS document_id, d.title, d.category, d.attached_to, d.school_id,
            sc.name AS school_name,
            CASE WHEN pp.id IS NOT NULL THEN pp.given_name || ' ' || pp.family_name END AS person_name,
            v.id AS version_id, v.version_no, v.file_name
       FROM (${STEP_SELECT} WHERE s.status = 'pending') w
       JOIN documents.approval_request q ON q.id = w.request_id
       JOIN documents.version v ON v.id = q.version_id
       JOIN documents.document d ON d.id = v.document_id
       LEFT JOIN org.school sc ON sc.id = d.school_id
       LEFT JOIN people.person pp ON pp.id = d.person_id
      WHERE w.may_decide
      ORDER BY q.requested_at, w.step_no`,
  );
  const steps = await stepsOf(
    tx,
    rows.map((row) => row.request_id),
  );
  return {
    waiting: rows.map((row) => ({
      stepId: row.id,
      stepNo: row.step_no,
      role: row.role_code,
      requestId: row.request_id,
      requestedAt: row.requested_at.toISOString(),
      documentId: row.document_id,
      title: row.title,
      category: row.category,
      attachedTo: row.attached_to,
      schoolId: row.school_id,
      schoolName: row.school_name,
      personName: row.person_name,
      versionId: row.version_id,
      versionNo: row.version_no,
      fileName: row.file_name,
      steps: steps.get(row.request_id) ?? [],
    })),
  };
}
