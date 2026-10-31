import {
  type Inquiry,
  type InquiryForm,
  type InquiryNoteKind,
  type InquiryOutcome,
  type SchoolId,
  type SchoolInquiries,
} from '@pythagoras/shared';
import { type InquiryFormRow, type PersonTransaction } from '../database/database';

// Inquiries from school websites (M5.1, ADR 0026). The database functions
// decide who may send, note and close an inquiry; row-level security decides
// who reads one: the school's staff with admissions.manage only.

export class InquiriesRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422 | 429,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [InquiriesRejected['status'], string]> = {
  P0002: [404, 'not found, or not yours to see'],
  '42501': [403, 'not permitted'],
  '23514': [422, 'a value is not allowed here'],
  PY001: [409, 'not possible in its present state'],
  PY020: [409, 'the privacy notice has changed; please read it again'],
  PY021: [429, 'too many inquiries just now; please try again later'],
  PY022: [409, 'this intake is not taking applications'],
  PY023: [409, 'this address is already known to the group; a group administrator can link the family'],
  PY024: [409, 'no place left in this intake; put the application on the waiting list'],
  PY025: [409, 'the offer has expired'],
  '22007': [422, 'the answer date is in the past'],
  '23P01': [409, 'the child is already enrolled at this school for those dates'],
  '23505': [
    409,
    'already there: one application per child and intake, and none to the school the child attends',
  ],
};

export async function refusalsAsInquiries<T>(work: () => Promise<T>, notFound?: string): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal)
      throw new InquiriesRejected(refusal[0], code === 'P0002' && notFound ? notFound : refusal[1]);
    throw error;
  }
}

/** The form's content from the database rows, or null when the website has no form. */
export function formFromRows(rows: readonly InquiryFormRow[]): InquiryForm | null {
  const first = rows[0];
  if (!first) return null;
  return {
    schools: rows.map((row) => ({ id: row.school_id as SchoolId, name: row.school_name })),
    notice: {
      id: first.notice_id,
      version: first.notice_version,
      text: first.notice_text,
      newsConsentText: first.news_consent_text,
    },
  };
}

interface InquiryRow {
  id: string;
  school_id: SchoolId;
  school_name: string;
  status: Inquiry['status'];
  outcome: InquiryOutcome | null;
  parent_name: string | null;
  email: string | null;
  phone: string | null;
  child_name: string | null;
  birth_year: number | null;
  grade_of_interest: string | null;
  intended_start: string | null;
  message: string | null;
  news_consent: boolean;
  notice_version: number;
  invited: boolean;
  received_at: Date;
  last_activity_at: Date;
}

interface NoteRow {
  inquiry_id: string;
  kind: Inquiry['notes'][number]['kind'];
  author_given: string | null;
  author_family: string | null;
  body: string | null;
  created_at: Date;
}

/** Inquiries at the schools where the viewer works on admissions, the most recently active first. */
export async function schoolInquiries(
  tx: PersonTransaction,
  status: SchoolInquiries['status'],
): Promise<SchoolInquiries> {
  const rows = await tx.query<InquiryRow>(
    `SELECT i.id, i.school_id, s.name AS school_name, i.status, i.outcome, i.parent_name, i.email, i.phone,
            i.child_name, i.birth_year, i.grade_of_interest, i.intended_start, i.message,
            (i.news_consent_at IS NOT NULL AND i.news_consent_withdrawn_at IS NULL) AS news_consent,
            n.version AS notice_version, i.applicant_person_id IS NOT NULL AS invited, i.received_at, i.last_activity_at
       FROM admissions.inquiry i
       JOIN org.school s ON s.id = i.school_id
       JOIN admissions.privacy_notice n ON n.id = i.notice_id
      WHERE ($1 = 'all' OR ($1 = 'open') = (i.status <> 'closed'))
      ORDER BY i.status = 'closed', i.last_activity_at DESC
      LIMIT 200`,
    [status],
  );
  const notes = rows.length
    ? await tx.query<NoteRow>(
        `SELECT n.inquiry_id, n.kind, p.given_name AS author_given, p.family_name AS author_family, n.body, n.created_at
           FROM admissions.inquiry_note n
           LEFT JOIN people.person p ON p.id = n.author_person_id
          WHERE n.inquiry_id = ANY ($1::uuid[])
          ORDER BY n.created_at`,
        [rows.map((row) => row.id)],
      )
    : [];
  return {
    status,
    inquiries: rows.map((row) => ({
      id: row.id,
      school: { id: row.school_id, name: row.school_name },
      status: row.status,
      outcome: row.outcome,
      parentName: row.parent_name,
      email: row.email,
      phone: row.phone,
      childName: row.child_name,
      birthYear: row.birth_year,
      gradeOfInterest: row.grade_of_interest,
      intendedStart: row.intended_start,
      message: row.message,
      newsConsent: row.news_consent,
      noticeVersion: row.notice_version,
      invited: row.invited,
      receivedAt: row.received_at.toISOString(),
      lastActivityAt: row.last_activity_at.toISOString(),
      notes: notes
        .filter((note) => note.inquiry_id === row.id)
        .map((note) => ({
          kind: note.kind,
          author: note.author_given
            ? [note.author_given, note.author_family].filter(Boolean).join(' ')
            : null,
          body: note.body,
          createdAt: note.created_at.toISOString(),
        })),
    })),
  };
}

export async function addNote(
  tx: PersonTransaction,
  inquiryId: string,
  kind: InquiryNoteKind,
  body: string,
): Promise<{ status: Inquiry['status'] }> {
  const [row] = await tx.query<{ status: Inquiry['status'] }>(
    'SELECT admissions.add_inquiry_note($1, $2, $3) AS status',
    [inquiryId, kind, body],
  );
  return { status: row!.status };
}

export async function closeInquiry(
  tx: PersonTransaction,
  inquiryId: string,
  outcome: InquiryOutcome,
): Promise<{ status: 'closed' }> {
  await tx.query('SELECT admissions.close_inquiry($1, $2)', [inquiryId, outcome]);
  return { status: 'closed' };
}
