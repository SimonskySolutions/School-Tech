import {
  type FamilyRequest,
  type PersonId,
  type RequestStatus,
  type SchoolId,
  type SchoolRequests,
  type StudentRequests,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Parent requests to School Life (M4.7). The database functions decide who
// may open, answer, take on or close a request; row-level security decides
// who reads it: the child's guardians and the school's staff with
// requests.manage.

export class RequestsRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [RequestsRejected['status'], string]> = {
  P0002: [404, 'no such request, or not yours to see'],
  '42501': [403, 'not permitted'],
  '23503': [422, 'the child does not attend this school'],
  '23514': [422, 'a value is not allowed here'],
  PY001: [409, 'the request is closed; open a new one'],
};

export async function refusalsAsRequests<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new RequestsRejected(refusal[0], refusal[1]);
    throw error;
  }
}

interface RequestRow {
  id: string;
  school_id: SchoolId;
  school_name: string;
  student_person_id: string;
  kind: FamilyRequest['kind'];
  subject: string;
  status: RequestStatus;
  created_at: Date;
  last_message_at: Date;
  student_given: string | null;
  student_family: string | null;
  class_label: string | null;
  requester_given: string | null;
  requester_family: string | null;
}

interface MessageRow {
  request_id: string;
  from_school: boolean;
  author_given: string | null;
  author_family: string | null;
  body: string;
  created_at: Date;
}

const REQUEST_COLUMNS = `r.id, r.school_id, sc.name AS school_name, r.student_person_id, r.kind, r.subject, r.status,
       r.created_at, r.last_message_at, st.given_name AS student_given, st.family_name AS student_family,
       e.class_label, rq.given_name AS requester_given, rq.family_name AS requester_family`;
const REQUEST_JOINS = `JOIN org.school sc ON sc.id = r.school_id
       LEFT JOIN people.person st ON st.id = r.student_person_id
       LEFT JOIN people.person rq ON rq.id = r.requested_by_person_id
       LEFT JOIN people.enrolment e ON e.student_person_id = r.student_person_id AND e.school_id = r.school_id
            AND e.status = 'active'`;

const name = (given: string | null, family: string | null) =>
  given ? [given, family].filter(Boolean).join(' ') : null;

async function withMessages(
  tx: PersonTransaction,
  rows: RequestRow[],
): Promise<(FamilyRequest & { row: RequestRow })[]> {
  const messages = rows.length
    ? await tx.query<MessageRow>(
        `SELECT m.request_id, m.from_school, p.given_name AS author_given, p.family_name AS author_family, m.body, m.created_at
           FROM people.family_request_message m
           LEFT JOIN people.person p ON p.id = m.author_person_id
          WHERE m.request_id = ANY ($1::uuid[])
          ORDER BY m.created_at, m.id`,
        [rows.map((row) => row.id)],
      )
    : [];
  return rows.map((row) => ({
    row,
    id: row.id,
    school: { id: row.school_id, name: row.school_name },
    kind: row.kind,
    subject: row.subject,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    lastMessageAt: row.last_message_at.toISOString(),
    messages: messages
      .filter((message) => message.request_id === row.id)
      .map((message) => ({
        fromSchool: message.from_school,
        // Families do not read staff records; the school signs as itself.
        authorName: name(message.author_given, message.author_family),
        body: message.body,
        createdAt: message.created_at.toISOString(),
      })),
  }));
}

export async function studentRequests(
  tx: PersonTransaction,
  studentId: string,
): Promise<StudentRequests | null> {
  const [student] = await tx.query<{ id: PersonId; given_name: string; family_name: string }>(
    `SELECT id, given_name, family_name FROM people.person WHERE id = $1 AND access.is_guardian_of(id, 'view')`,
    [studentId],
  );
  if (!student) return null;
  const schools = await tx.query<{ id: SchoolId; name: string }>(
    `SELECT DISTINCT s.id, s.name FROM people.enrolment e JOIN org.school s ON s.id = e.school_id
      WHERE e.student_person_id = $1 AND e.status = 'active'
        AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date > current_date)
      ORDER BY s.name`,
    [studentId],
  );
  const rows = await tx.query<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM people.family_request r ${REQUEST_JOINS}
      WHERE r.student_person_id = $1
      ORDER BY r.status = 'closed', r.last_message_at DESC`,
    [studentId],
  );
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    schools: schools.map((school) => ({ id: school.id, name: school.name })),
    requests: (await withMessages(tx, rows)).map(({ row: _row, ...request }) => request),
  };
}

export async function schoolRequests(
  tx: PersonTransaction,
  filter: 'active' | RequestStatus,
): Promise<SchoolRequests> {
  const rows = await tx.query<RequestRow>(
    `SELECT ${REQUEST_COLUMNS} FROM people.family_request r ${REQUEST_JOINS}
      WHERE access.has_permission('requests.manage', r.school_id)
        AND (($1 = 'active' AND r.status <> 'closed') OR r.status = $1)
      ORDER BY r.status = 'answered', r.last_message_at
      LIMIT 200`,
    [filter],
  );
  return {
    filter,
    requests: (await withMessages(tx, rows)).map(({ row, ...request }) => ({
      ...request,
      studentName: name(row.student_given, row.student_family),
      classLabel: row.class_label,
      requestedBy: name(row.requester_given, row.requester_family),
    })),
  };
}

export async function openRequest(
  tx: PersonTransaction,
  studentId: string,
  body: { schoolId: string; kind: FamilyRequest['kind']; subject: string; message: string },
): Promise<{ requestId: string }> {
  const [row] = await tx.query<{ id: string }>(
    'SELECT people.open_family_request($1, $2, $3, $4, $5) AS id',
    [studentId, body.schoolId, body.kind, body.subject, body.message],
  );
  return { requestId: row!.id };
}

export async function reply(
  tx: PersonTransaction,
  requestId: string,
  message: string,
  studentId?: string,
): Promise<{ requestId: string; status: RequestStatus }> {
  if (studentId) await ownedBy(tx, requestId, studentId);
  const [row] = await tx.query<{ status: RequestStatus }>(
    'SELECT people.reply_to_family_request($1, $2) AS status',
    [requestId, message],
  );
  return { requestId, status: row!.status };
}

export async function setStatus(
  tx: PersonTransaction,
  requestId: string,
  status: 'in_progress' | 'closed',
  studentId?: string,
): Promise<{ requestId: string; status: RequestStatus }> {
  if (studentId) await ownedBy(tx, requestId, studentId);
  const [row] = await tx.query<{ status: RequestStatus }>(
    'SELECT people.set_family_request_status($1, $2) AS status',
    [requestId, status],
  );
  return { requestId, status: row!.status };
}

async function ownedBy(tx: PersonTransaction, requestId: string, studentId: string): Promise<void> {
  const [row] = await tx.query(
    'SELECT 1 FROM people.family_request WHERE id = $1 AND student_person_id = $2',
    [requestId, studentId],
  );
  if (!row) throw new RequestsRejected(404, 'no such request for this child');
}
