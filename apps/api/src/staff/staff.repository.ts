import {
  type ContractKind,
  type Employment,
  type EmploymentRequestBody,
  type ExpiryState,
  type MyStaffRecords,
  type Qualification,
  type QualificationKind,
  type RecordCheck,
  type SchoolId,
  type SchoolStaff,
  type StaffAttention,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Staff records (M6.1, ADR 0028). The database functions decide who may
// record or end an employment; row-level security decides who reads one: the
// person themself and staff.read where they work.

export class StaffRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [StaffRejected['status'], string]> = {
  P0002: [404, 'no such member of staff or employment here'],
  '42501': [403, 'not permitted'],
  '23503': [422, 'the employer must be a company of the group'],
  '23514': [422, 'a value is not allowed here'],
  PY001: [409, 'not possible in its present state'],
};

export async function refusalsAsStaff<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new StaffRejected(refusal[0], refusal[1]);
    throw error;
  }
}

interface EmploymentRow {
  id: string;
  person_id: string;
  employer_id: string;
  employer_name: string;
  school_id: SchoolId | null;
  school_name: string | null;
  position: string;
  contract_kind: ContractKind;
  working_time: string;
  start_date: string;
  end_date: string | null;
  current: boolean;
  work_email: string | null;
  work_phone: string | null;
}

const EMPLOYMENT_SELECT = `
  SELECT e.id, e.person_id, e.employer_id, le.legal_name AS employer_name, e.school_id, s.name AS school_name,
         e.position, e.contract_kind, e.working_time::text, to_char(e.start_date, 'YYYY-MM-DD') AS start_date,
         to_char(e.end_date, 'YYYY-MM-DD') AS end_date,
         (e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date >= current_date)) AS current,
         e.work_email, e.work_phone
    FROM staff.employment e
    JOIN org.legal_entity le ON le.id = e.employer_id
    LEFT JOIN org.school s ON s.id = e.school_id`;

const employmentOf = (row: EmploymentRow): Employment => ({
  id: row.id,
  employer: { id: row.employer_id, name: row.employer_name },
  school: row.school_id ? { id: row.school_id, name: row.school_name ?? '' } : null,
  position: row.position,
  contractKind: row.contract_kind,
  workingTime: Number(row.working_time),
  startDate: row.start_date,
  endDate: row.end_date,
  current: row.current,
  workEmail: row.work_email,
  workPhone: row.work_phone,
});

/** How long before an end a qualification or check is flagged (M6.2). */
export const EXPIRY_WARNING_DAYS = 60;

/** Pure: an end date against today (YYYY-MM-DD strings compare as dates). */
export function expiryState(end: string | null, today: string): ExpiryState {
  if (!end) return 'valid';
  if (end < today) return 'expired';
  const warn = new Date(`${today}T00:00:00Z`);
  warn.setUTCDate(warn.getUTCDate() + EXPIRY_WARNING_DAYS);
  return end <= warn.toISOString().slice(0, 10) ? 'expiring' : 'valid';
}

/**
 * Pure: what the leaders should see to. Everyone employed here now needs a
 * valid record check; anyone with the teacher role a valid teaching licence.
 */
export function attentionFor(
  person: { roles: readonly string[]; employments: readonly Pick<Employment, 'current'>[] },
  qualifications: readonly Qualification[],
  check: RecordCheck | null,
): StaffAttention[] {
  const attention: StaffAttention[] = [];
  if (person.employments.some((employment) => employment.current)) {
    if (!check) attention.push('check_missing');
    else if (check.state === 'expired') attention.push('check_expired');
    else if (check.state === 'expiring') attention.push('check_expiring');
  }
  if (
    person.roles.includes('teacher') &&
    !qualifications.some((q) => q.kind === 'teaching_licence' && q.state !== 'expired')
  ) {
    attention.push('licence_missing');
  }
  if (qualifications.some((q) => q.state === 'expired')) attention.push('qualification_expired');
  if (qualifications.some((q) => q.state === 'expiring')) attention.push('qualification_expiring');
  return attention;
}

interface QualificationRow {
  id: string;
  person_id: string;
  kind: QualificationKind;
  title: string;
  issuer: string | null;
  awarded_on: string;
  expires_on: string | null;
}

interface CheckRow {
  person_id: string;
  seen_on: string;
  valid_until: string;
  seen_by_given: string | null;
  seen_by_family: string | null;
}

async function qualificationsOf(tx: PersonTransaction, personIds: readonly string[], today: string) {
  if (personIds.length === 0)
    return {
      qualifications: [] as (Qualification & { personId: string })[],
      checks: new Map<string, RecordCheck>(),
    };
  const rows = await tx.query<QualificationRow>(
    `SELECT id, person_id, kind, title, issuer, to_char(awarded_on, 'YYYY-MM-DD') AS awarded_on,
            to_char(expires_on, 'YYYY-MM-DD') AS expires_on
       FROM staff.qualification WHERE person_id = ANY ($1::uuid[]) AND withdrawn_at IS NULL
      ORDER BY awarded_on DESC`,
    [personIds],
  );
  const checks = await tx.query<CheckRow>(
    `SELECT DISTINCT ON (c.person_id) c.person_id, to_char(c.seen_on, 'YYYY-MM-DD') AS seen_on,
            to_char(c.valid_until, 'YYYY-MM-DD') AS valid_until, p.given_name AS seen_by_given, p.family_name AS seen_by_family
       FROM staff.record_check c LEFT JOIN people.person p ON p.id = c.seen_by_person_id
      WHERE c.person_id = ANY ($1::uuid[])
      ORDER BY c.person_id, c.valid_until DESC`,
    [personIds],
  );
  return {
    qualifications: rows.map((row) => ({
      personId: row.person_id,
      id: row.id,
      kind: row.kind,
      title: row.title,
      issuer: row.issuer,
      awardedOn: row.awarded_on,
      expiresOn: row.expires_on,
      state: expiryState(row.expires_on, today),
    })),
    checks: new Map(
      checks.map((row) => [
        row.person_id,
        {
          seenOn: row.seen_on,
          validUntil: row.valid_until,
          seenBy: row.seen_by_given ? `${row.seen_by_given} ${row.seen_by_family ?? ''}`.trim() : null,
          state: expiryState(row.valid_until, today),
        },
      ]),
    ),
  };
}

const today = async (tx: PersonTransaction) =>
  (await tx.query<{ today: string }>(`SELECT to_char(current_date, 'YYYY-MM-DD') AS today`))[0]!.today;

const withoutPerson = ({ personId: _personId, ...qualification }: Qualification & { personId: string }) =>
  qualification;

/** Pure: whether access and employment disagree for someone at a school. */
export function mismatchOf(
  roles: readonly string[],
  employments: readonly Pick<Employment, 'current'>[],
): SchoolStaff['people'][number]['mismatch'] {
  const employed = employments.some((employment) => employment.current);
  if (roles.length > 0 && !employed) return 'role_without_employment';
  if (roles.length === 0 && employed) return 'employment_without_role';
  return null;
}

/** A school's staff with their roles there and their employments there, or null without staff.read. */
export async function schoolStaff(tx: PersonTransaction, schoolId: string): Promise<SchoolStaff | null> {
  const [school] = await tx.query<{ id: SchoolId; name: string; read: boolean; manage: boolean }>(
    `SELECT id, name, staff.may('staff.read', id) AS read, staff.may('staff.manage', id) AS manage
       FROM org.school WHERE id = $1`,
    [schoolId],
  );
  if (!school?.read) return null;
  const people = await tx.query<{
    person_id: string;
    given_name: string;
    family_name: string;
    email: string | null;
    roles: string[];
  }>('SELECT person_id, given_name, family_name, email, roles FROM staff.school_staff($1)', [schoolId]);
  const employments = await tx.query<EmploymentRow>(
    `${EMPLOYMENT_SELECT} WHERE e.school_id = $1 ORDER BY e.start_date DESC`,
    [schoolId],
  );
  const employers = await tx.query<{ id: string; legal_name: string }>(
    `SELECT id, legal_name FROM org.legal_entity WHERE group_id = access.current_group_id() ORDER BY legal_name`,
  );
  const day = await today(tx);
  const held = await qualificationsOf(
    tx,
    people.map((person) => person.person_id),
    day,
  );
  return {
    school: { id: school.id, name: school.name },
    canManage: school.manage,
    employers: employers.map((row) => ({ id: row.id, name: row.legal_name })),
    people: people.map((person) => {
      const own = employments.filter((row) => row.person_id === person.person_id).map(employmentOf);
      const qualifications = held.qualifications
        .filter((q) => q.personId === person.person_id)
        .map(withoutPerson);
      const recordCheck = held.checks.get(person.person_id) ?? null;
      return {
        personId: person.person_id,
        name: `${person.given_name} ${person.family_name}`,
        email: person.email,
        roles: person.roles,
        employments: own,
        mismatch: mismatchOf(person.roles, own),
        qualifications,
        recordCheck,
        attention: attentionFor({ roles: person.roles, employments: own }, qualifications, recordCheck),
      };
    }),
  };
}

/** The signed-in person's own employments, qualifications and latest check. */
export async function myRecords(tx: PersonTransaction): Promise<MyStaffRecords> {
  const rows = await tx.query<EmploymentRow>(
    `${EMPLOYMENT_SELECT} WHERE e.person_id = app.current_person_id() ORDER BY e.start_date DESC`,
  );
  const [me] = await tx.query<{ id: string }>('SELECT app.current_person_id() AS id');
  const held = await qualificationsOf(tx, me?.id ? [me.id] : [], await today(tx));
  return {
    employments: rows.map(employmentOf),
    qualifications: held.qualifications.map(withoutPerson),
    recordCheck: me?.id ? (held.checks.get(me.id) ?? null) : null,
  };
}

export async function recordQualification(
  tx: PersonTransaction,
  personId: string,
  body: { kind: QualificationKind; title: string; issuer?: string; awardedOn: string; expiresOn?: string },
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    'SELECT staff.record_qualification($1, $2, $3, $4, $5::date, $6::date) AS id',
    [personId, body.kind, body.title, body.issuer ?? null, body.awardedOn, body.expiresOn ?? null],
  );
  return { id: row!.id };
}

export async function withdrawQualification(tx: PersonTransaction, qualificationId: string) {
  await tx.query('SELECT staff.withdraw_qualification($1)', [qualificationId]);
  return { status: 'withdrawn' as const };
}

/** Only that a satisfactory certificate was seen, and until when it is valid (Art. 10). */
export async function recordCheck(
  tx: PersonTransaction,
  personId: string,
  body: { seenOn: string; validUntil: string },
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>('SELECT staff.record_check($1, $2::date, $3::date) AS id', [
    personId,
    body.seenOn,
    body.validUntil,
  ]);
  return { id: row!.id };
}

export async function recordEmployment(
  tx: PersonTransaction,
  schoolId: string,
  body: EmploymentRequestBody,
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    `SELECT staff.record_employment($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10) AS id`,
    [
      body.personId,
      body.employerId,
      schoolId,
      body.position,
      body.contractKind,
      body.workingTime,
      body.startDate,
      body.endDate ?? null,
      body.workEmail ?? null,
      body.workPhone ?? null,
    ],
  );
  return { id: row!.id };
}

export async function endEmployment(tx: PersonTransaction, employmentId: string, endDate: string) {
  await tx.query('SELECT staff.end_employment($1, $2::date)', [employmentId, endDate]);
  return { endDate };
}
