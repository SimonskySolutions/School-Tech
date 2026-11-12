import {
  type AddGuardianRequest,
  type AddGuardianResponse,
  type EnrolStudentRequest,
  type PersonId,
  type SchoolId,
  type StudentList,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Students and their families at one school (M3.3). Every statement runs as
// the signed-in member of staff: row-level security decides who may enrol
// (enrolment.manage), register people (people.manage) and record guardians
// (guardians.manage). A guardian recorded by staff is verified at once, by
// them; the parent then sees the child next to any children at other schools.

export class FamiliesRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 422,
    message: string,
  ) {
    super(message);
  }
}

async function schoolFor(tx: PersonTransaction, schoolId: string, permission: string) {
  const [school] = await tx.query<{ id: SchoolId; name: string; allowed: boolean }>(
    `SELECT id, name, access.has_permission($2, id) AS allowed FROM org.school WHERE id = $1`,
    [schoolId, permission],
  );
  if (!school) throw new FamiliesRejected(404, 'no such school');
  if (!school.allowed) throw new FamiliesRejected(403, 'not permitted at this school');
  return school;
}

export async function listStudents(tx: PersonTransaction, schoolId: string): Promise<StudentList> {
  const school = await schoolFor(tx, schoolId, 'enrolment.read');
  const [may] = await tx.query<{ enrol: boolean; guardians: boolean }>(
    `SELECT access.has_permission('enrolment.manage', $1) AND access.has_permission('people.manage', $1) AS enrol,
            access.has_permission('guardians.manage', $1) AS guardians`,
    [school.id],
  );
  const students = await tx.query<{
    id: PersonId;
    given_name: string;
    family_name: string;
    academic_year: string;
    grade_level: string | null;
    class_label: string | null;
  }>(
    `SELECT p.id, p.given_name, p.family_name, e.academic_year, e.grade_level, e.class_label
       FROM people.enrolment e JOIN people.person p ON p.id = e.student_person_id
      WHERE e.school_id = $1 AND e.status = 'active'
      ORDER BY e.class_label NULLS LAST, p.family_name, p.given_name`,
    [school.id],
  );
  const guardians = students.length
    ? await tx.query<{
        student_person_id: string;
        guardian_person_id: PersonId;
        given_name: string | null;
        family_name: string | null;
        relationship: string;
        status: 'pending' | 'active';
        can_pay: boolean;
        can_manage_bookings: boolean;
        can_consent: boolean;
      }>(
        `SELECT g.student_person_id, g.guardian_person_id, p.given_name, p.family_name, g.relationship, g.status,
                g.can_pay, g.can_manage_bookings, g.can_consent
           FROM people.guardian_relationship g LEFT JOIN people.person p ON p.id = g.guardian_person_id
          WHERE g.student_person_id = ANY ($1::uuid[]) AND g.status IN ('pending', 'active')
          ORDER BY g.status, p.family_name`,
        [students.map((student) => student.id)],
      )
    : [];
  return {
    school: { id: school.id, name: school.name },
    canEnrol: Boolean(may?.enrol),
    canRecordGuardians: Boolean(may?.guardians),
    students: students.map((student) => ({
      id: student.id,
      givenName: student.given_name,
      familyName: student.family_name,
      academicYear: student.academic_year,
      gradeLevel: student.grade_level,
      classLabel: student.class_label,
      guardians: guardians
        .filter((guardian) => guardian.student_person_id === student.id)
        .map((guardian) => ({
          personId: guardian.guardian_person_id,
          name:
            [guardian.given_name, guardian.family_name].filter(Boolean).join(' ') ||
            'Name hidden for your role',
          relationship: guardian.relationship,
          status: guardian.status,
          canPay: guardian.can_pay,
          canManageBookings: guardian.can_manage_bookings,
          canConsent: guardian.can_consent,
        })),
    })),
  };
}

export async function enrolStudent(
  tx: PersonTransaction,
  schoolId: string,
  body: EnrolStudentRequest,
): Promise<{ studentId: PersonId }> {
  const school = await schoolFor(tx, schoolId, 'enrolment.manage');
  const [student] = await tx.query<{ id: PersonId }>(
    `INSERT INTO people.person (group_id, given_name, family_name, date_of_birth, registered_school_id)
     VALUES (access.current_group_id(), $1, $2, $3, $4) RETURNING id`,
    [body.givenName, body.familyName, body.dateOfBirth ?? null, school.id],
  );
  await tx.query(
    `INSERT INTO people.enrolment (group_id, student_person_id, school_id, academic_year, grade_level, class_label, start_date)
     VALUES (access.current_group_id(), $1, $2, $3, $4, $5, $6)`,
    [
      student!.id,
      school.id,
      body.academicYear,
      body.gradeLevel ?? null,
      body.classLabel ?? null,
      body.startDate,
    ],
  );
  return { studentId: student!.id };
}

export async function addGuardian(
  tx: PersonTransaction,
  schoolId: string,
  studentId: string,
  body: AddGuardianRequest,
): Promise<AddGuardianResponse> {
  const school = await schoolFor(tx, schoolId, 'guardians.manage');
  const [enrolled] = await tx.query<{ id: string }>(
    `SELECT id FROM people.enrolment WHERE student_person_id = $1 AND school_id = $2 AND status = 'active'`,
    [studentId, school.id],
  );
  if (!enrolled) throw new FamiliesRejected(404, 'no such student at this school');

  // A parent who already exists (children at another school) is linked, never registered twice.
  const [found] = await tx.query<{ id: PersonId | null }>(
    'SELECT people.find_person_by_email($1, $2) AS id',
    [body.email, school.id],
  );
  let guardianId = found?.id ?? null;
  const existing = guardianId !== null;
  if (!guardianId) {
    if (!body.givenName || !body.familyName) {
      throw new FamiliesRejected(
        422,
        "no one has this e-mail yet: give the guardian's first and family name",
      );
    }
    const [created] = await tx.query<{ id: PersonId }>(
      `INSERT INTO people.person (group_id, given_name, family_name, email, registered_school_id)
       VALUES (access.current_group_id(), $1, $2, $3, $4) RETURNING id`,
      [body.givenName, body.familyName, body.email.trim().toLowerCase(), school.id],
    );
    guardianId = created!.id;
  }

  await tx.query(
    `INSERT INTO people.guardian_relationship
       (group_id, guardian_person_id, student_person_id, relationship, can_pay, can_manage_bookings, can_consent,
        status, verified_by_person_id, verified_at)
     VALUES (access.current_group_id(), $1, $2, $3, $4, $5, $6, 'active', app.current_person_id(), now())`,
    [
      guardianId,
      studentId,
      body.relationship,
      body.canPay ?? true,
      body.canManageBookings ?? true,
      body.canConsent ?? false,
    ],
  );
  return { guardianPersonId: guardianId, existing };
}
