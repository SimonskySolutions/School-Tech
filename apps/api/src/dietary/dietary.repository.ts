import {
  type Allergen,
  type DietaryNeed,
  type DietaryNeedRequest,
  type DietaryReview,
  type PersonId,
  type SchoolId,
  type StudentDietary,
} from '@pythagoras/shared';
import { logSensitiveReads, readsPerChild } from '../common/access-log';
import { type PersonTransaction } from '../database/database';

// A child's dietary and health needs (M4.1, ADR 0006). Row-level security
// decides who reads and writes them; the database decides verification: a
// guardian's need or change is unverified until School Life verifies it, as
// themselves. Every read of these rows is written to the access log.

export class DietaryRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

interface NeedRow {
  id: string;
  student_person_id: string;
  school_id: string | null;
  kind: DietaryNeed['kind'];
  description: string;
  severity: DietaryNeed['severity'];
  allergens: Allergen[];
  valid_from: string;
  valid_until: string | null;
  verified_at: Date | null;
  mine_unverified: boolean;
}

const NEED_COLUMNS = `dr.id, dr.student_person_id, dr.kind, dr.description, dr.severity, dr.allergens,
       to_char(dr.valid_from, 'YYYY-MM-DD') AS valid_from, to_char(dr.valid_until, 'YYYY-MM-DD') AS valid_until,
       dr.verified_at,
       (dr.verified_by_person_id IS NULL AND dr.provided_by_person_id = app.current_person_id()) AS mine_unverified`;

/** Needs that apply today or later; ended ones stay in the database and the audit log. */
const CURRENT = '(dr.valid_until IS NULL OR dr.valid_until >= current_date)';

function toNeed(row: NeedRow): DietaryNeed {
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    severity: row.severity,
    allergens: row.allergens,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    verified: row.verified_at !== null,
    verifiedAt: row.verified_at?.toISOString() ?? null,
  };
}

/** A guardian's view of one child; null when the child is not theirs. */
export async function studentDietary(
  tx: PersonTransaction,
  studentId: string,
): Promise<StudentDietary | null> {
  const [student] = await tx.query<{
    id: PersonId;
    given_name: string;
    family_name: string;
    can_change: boolean;
  }>(
    `SELECT id, given_name, family_name, access.is_guardian_of(id, 'manage_bookings') AS can_change
       FROM people.person WHERE id = $1 AND access.is_guardian_of(id, 'view')`,
    [studentId],
  );
  if (!student) return null;
  const rows = await tx.query<NeedRow>(
    `SELECT ${NEED_COLUMNS}, NULL::uuid AS school_id
       FROM sensitive.dietary_requirement dr
      WHERE dr.student_person_id = $1 AND ${CURRENT}
      ORDER BY dr.created_at, dr.id`,
    [studentId],
  );
  await logSensitiveReads(tx, 'sensitive.dietary_requirement:family', readsPerChild(rows));
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    canChange: student.can_change,
    needs: rows.map((row) => ({ ...toNeed(row), canWithdraw: row.mine_unverified })),
  };
}

export async function addNeed(
  tx: PersonTransaction,
  studentId: string,
  need: DietaryNeedRequest,
): Promise<DietaryNeed> {
  const [row] = await tx.query<NeedRow>(
    `WITH added AS (
       INSERT INTO sensitive.dietary_requirement
              (group_id, student_person_id, kind, description, severity, allergens, provided_by_person_id)
       VALUES (access.current_group_id(), $1, $2, $3, $4, $5, app.current_person_id())
       RETURNING *)
     SELECT ${NEED_COLUMNS}, NULL::uuid AS school_id FROM added dr`,
    [studentId, need.kind, need.description, need.severity ?? null, need.allergens],
  );
  return toNeed(row!);
}

export async function changeNeed(
  tx: PersonTransaction,
  studentId: string,
  needId: string,
  need: DietaryNeedRequest,
): Promise<DietaryNeed> {
  const [row] = await tx.query<NeedRow>(
    `WITH changed AS (
       UPDATE sensitive.dietary_requirement
          SET kind = $3, description = $4, severity = $5, allergens = $6
        WHERE id = $1 AND student_person_id = $2 AND (valid_until IS NULL OR valid_until >= current_date)
       RETURNING *)
     SELECT ${NEED_COLUMNS}, NULL::uuid AS school_id FROM changed dr`,
    [needId, studentId, need.kind, need.description, need.severity ?? null, need.allergens],
  );
  if (!row) throw new DietaryRejected(404, 'no such current need for this child, or not yours to change');
  return toNeed(row);
}

/** The need stops applying after today; the kitchen still sees it for today's lunch. */
export async function endNeed(
  tx: PersonTransaction,
  studentId: string,
  needId: string,
): Promise<DietaryNeed> {
  const [row] = await tx.query<NeedRow>(
    `WITH ended AS (
       UPDATE sensitive.dietary_requirement
          SET valid_until = greatest(valid_from, current_date)
        WHERE id = $1 AND student_person_id = $2 AND (valid_until IS NULL OR valid_until > current_date)
       RETURNING *)
     SELECT ${NEED_COLUMNS}, NULL::uuid AS school_id FROM ended dr`,
    [needId, studentId],
  );
  if (!row) throw new DietaryRejected(404, 'no such current need for this child, or not yours to change');
  return toNeed(row);
}

/** Takes back an unverified need the guardian recorded; anything else is ended instead. */
export async function withdrawNeed(tx: PersonTransaction, studentId: string, needId: string): Promise<void> {
  const deleted = await tx.query(
    'DELETE FROM sensitive.dietary_requirement WHERE id = $1 AND student_person_id = $2 RETURNING id',
    [needId, studentId],
  );
  if (deleted.length) return;
  const [exists] = await tx.query(
    'SELECT 1 FROM sensitive.dietary_requirement WHERE id = $1 AND student_person_id = $2',
    [needId, studentId],
  );
  if (!exists) throw new DietaryRejected(404, 'no such need for this child');
  throw new DietaryRejected(
    409,
    'only an unverified need you recorded can be taken back; end this one instead',
  );
}

interface ReviewRow extends NeedRow {
  school_id: SchoolId;
  school_name: string;
  given_name: string;
  family_name: string;
  class_label: string | null;
  can_verify: boolean;
}

/** Current needs of children enrolled where the viewer may read them, unverified first. */
export async function dietaryReview(tx: PersonTransaction): Promise<DietaryReview> {
  const rows = await tx.query<ReviewRow>(
    `SELECT ${NEED_COLUMNS}, e.school_id, sc.name AS school_name, p.given_name, p.family_name, e.class_label,
            access.has_permission('sensitive.dietary.manage', e.school_id) AS can_verify
       FROM sensitive.dietary_requirement dr
       JOIN people.enrolment e ON e.student_person_id = dr.student_person_id AND e.status = 'active'
       JOIN org.school sc ON sc.id = e.school_id
       JOIN people.person p ON p.id = dr.student_person_id
      WHERE ${CURRENT} AND access.has_permission('sensitive.dietary.read', e.school_id)
      ORDER BY sc.name, dr.verified_at IS NOT NULL, p.family_name, p.given_name, dr.created_at`,
  );
  await logSensitiveReads(tx, 'sensitive.dietary_requirement:review', readsPerChild(rows));
  const schools = new Map<string, DietaryReview['schools'][number]>();
  for (const row of rows) {
    const school = schools.get(row.school_id) ?? {
      school: { id: row.school_id, name: row.school_name },
      canVerify: row.can_verify,
      needs: [],
    };
    school.needs.push({
      ...toNeed(row),
      studentName: `${row.given_name} ${row.family_name}`,
      classLabel: row.class_label,
    });
    schools.set(row.school_id, school);
  }
  return { schools: [...schools.values()] };
}

/** School Life verifies a need as themselves; the database refuses everyone else. */
export async function verifyNeed(tx: PersonTransaction, needId: string): Promise<DietaryNeed> {
  const [row] = await tx.query<NeedRow>(
    `WITH verified AS (
       UPDATE sensitive.dietary_requirement SET verified_by_person_id = app.current_person_id()
        WHERE id = $1 RETURNING *)
     SELECT ${NEED_COLUMNS}, NULL::uuid AS school_id FROM verified dr`,
    [needId],
  );
  if (!row) throw new DietaryRejected(404, 'no such need, or not yours to verify');
  return toNeed(row);
}
