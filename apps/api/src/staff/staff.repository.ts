import {
  type ContractKind,
  type Employment,
  type EmploymentRequestBody,
  type SchoolId,
  type SchoolStaff,
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
  PY001: [409, 'the employment already ends by then'],
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
  return {
    school: { id: school.id, name: school.name },
    canManage: school.manage,
    employers: employers.map((row) => ({ id: row.id, name: row.legal_name })),
    people: people.map((person) => {
      const own = employments.filter((row) => row.person_id === person.person_id).map(employmentOf);
      return {
        personId: person.person_id,
        name: `${person.given_name} ${person.family_name}`,
        email: person.email,
        roles: person.roles,
        employments: own,
        mismatch: mismatchOf(person.roles, own),
      };
    }),
  };
}

/** The signed-in person's own employments. */
export async function myEmployments(tx: PersonTransaction): Promise<Employment[]> {
  const rows = await tx.query<EmploymentRow>(
    `${EMPLOYMENT_SELECT} WHERE e.person_id = app.current_person_id() ORDER BY e.start_date DESC`,
  );
  return rows.map(employmentOf);
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
