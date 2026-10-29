import { type PersonId, type SchoolId } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Reads for the signed-in person. Every query runs inside withPerson(), so the
// database's row-level security limits the results; the WHERE clauses only
// narrow them further (to "my" roles, "my" children).

export interface MeRow {
  id: PersonId;
  given_name: string;
  family_name: string;
  preferred_name: string | null;
  email: string | null;
}

export interface RoleRow {
  role_code: string;
  role_name: string;
  scope_level: 'group' | 'school';
  school_id: SchoolId | null;
  school_name: string | null;
}

export interface ChildRow {
  id: PersonId;
  given_name: string;
  family_name: string;
  relationship: string;
  can_view: boolean;
  can_pay: boolean;
  can_manage_bookings: boolean;
  can_consent: boolean;
}

export interface EnrolmentRow {
  student_person_id: PersonId;
  school_id: SchoolId;
  school_code: string;
  school_name: string;
  academic_year: string;
  grade_level: string | null;
  class_label: string | null;
  status: string;
}

export function findMe(tx: PersonTransaction): Promise<MeRow[]> {
  return tx.query<MeRow>(
    `SELECT id, given_name, family_name, preferred_name, email
       FROM people.person
      WHERE id = app.current_person_id()`,
  );
}

export function findMyRoles(tx: PersonTransaction): Promise<RoleRow[]> {
  return tx.query<RoleRow>(
    `SELECT ra.role_code, r.name AS role_name, r.scope_level, ra.school_id, s.name AS school_name
       FROM access.role_assignment ra
       JOIN access.role r ON r.code = ra.role_code
       LEFT JOIN org.school s ON s.id = ra.school_id
      WHERE ra.person_id = app.current_person_id()
        AND ra.revoked_at IS NULL
        AND ra.valid_from <= now()
        AND (ra.valid_until IS NULL OR ra.valid_until > now())
      ORDER BY r.scope_level, s.name NULLS FIRST, r.name`,
  );
}

export function findMyChildren(tx: PersonTransaction): Promise<ChildRow[]> {
  return tx.query<ChildRow>(
    `SELECT p.id, p.given_name, p.family_name, g.relationship,
            g.can_view, g.can_pay, g.can_manage_bookings, g.can_consent
       FROM people.guardian_relationship g
       JOIN people.person p ON p.id = g.student_person_id
      WHERE g.guardian_person_id = app.current_person_id()
        AND g.status = 'active'
        AND g.valid_from <= current_date
        AND (g.valid_until IS NULL OR g.valid_until >= current_date)
      ORDER BY p.given_name, p.family_name`,
  );
}

export function findCurrentEnrolments(
  tx: PersonTransaction,
  studentIds: readonly PersonId[],
): Promise<EnrolmentRow[]> {
  if (studentIds.length === 0) return Promise.resolve([]);
  return tx.query<EnrolmentRow>(
    `SELECT e.student_person_id, e.school_id, s.code AS school_code, s.name AS school_name,
            e.academic_year, e.grade_level, e.class_label, e.status
       FROM people.enrolment e
       JOIN org.school s ON s.id = e.school_id
      WHERE e.student_person_id = ANY ($1::uuid[])
        AND e.status IN ('active', 'suspended')
      ORDER BY s.name`,
    [studentIds],
  );
}
