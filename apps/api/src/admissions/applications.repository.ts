import {
  type ApplicationRequestBody,
  type ApplicationStatus,
  type FamilyAdmissions,
  type Intake,
  type IntakeRequestBody,
  type SchoolApplications,
  type SchoolId,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Intakes and applications (M5.2, ADR 0027). The database functions decide
// who may open an intake, apply, review or withdraw; row-level security
// decides who reads: open intakes for every signed-in person of the group,
// an application for the parent who made it and the school's admissions staff.

interface IntakeRow {
  id: string;
  school_id: SchoolId;
  school_name: string;
  school_year: string;
  grade: string;
  places: number;
  opens_on: string;
  closes_on: string;
  status: Intake['status'];
  taking: boolean;
}

const INTAKE_COLUMNS = `it.id, it.school_id, s.name AS school_name, it.school_year, it.grade, it.places,
       to_char(it.opens_on, 'YYYY-MM-DD') AS opens_on, to_char(it.closes_on, 'YYYY-MM-DD') AS closes_on, it.status,
       (it.status = 'open' AND (now() AT TIME ZONE s.time_zone)::date BETWEEN it.opens_on AND it.closes_on) AS taking`;

const intakeOf = (row: IntakeRow): Intake => ({
  id: row.id,
  school: { id: row.school_id, name: row.school_name },
  schoolYear: row.school_year,
  grade: row.grade,
  places: row.places,
  opensOn: row.opens_on,
  closesOn: row.closes_on,
  status: row.status,
  takingApplications: row.taking,
});

const fullName = (given: string | null, family: string | null) =>
  given ? [given, family].filter(Boolean).join(' ') : null;

/** A signed-in parent's view: open intakes, the children they may apply for, their own applications. */
export async function familyAdmissions(tx: PersonTransaction): Promise<FamilyAdmissions> {
  const intakes = await tx.query<IntakeRow>(
    `SELECT ${INTAKE_COLUMNS}
       FROM admissions.intake it JOIN org.school s ON s.id = it.school_id
      WHERE it.status = 'open' AND s.status = 'active'
      ORDER BY s.name, it.school_year, it.grade`,
  );
  const children = await tx.query<{ id: string; given_name: string; family_name: string }>(
    `SELECT p.id, p.given_name, p.family_name
       FROM people.guardian_relationship g JOIN people.person p ON p.id = g.student_person_id
      WHERE g.guardian_person_id = app.current_person_id() AND access.is_guardian_of(p.id, 'consent')
      ORDER BY p.given_name`,
  );
  const applications = await tx.query<{
    id: string;
    school_id: SchoolId;
    school_name: string;
    intake_id: string;
    school_year: string;
    grade: string;
    child_given: string | null;
    child_family: string | null;
    status: ApplicationStatus;
    submitted_at: Date;
  }>(
    `SELECT a.id, a.school_id, s.name AS school_name, a.intake_id, it.school_year, it.grade,
            coalesce(p.given_name, a.child_given_name) AS child_given, coalesce(p.family_name, a.child_family_name) AS child_family,
            a.status, a.submitted_at
       FROM admissions.application a
       JOIN admissions.intake it ON it.id = a.intake_id
       JOIN org.school s ON s.id = a.school_id
       LEFT JOIN people.person p ON p.id = a.student_person_id
      WHERE a.applicant_person_id = app.current_person_id()
      ORDER BY a.submitted_at DESC`,
  );
  const [notice] = await tx.query<{ id: string; version: number; notice_text: string }>(
    `SELECT id, version, notice_text FROM admissions.privacy_notice
      WHERE group_id = access.current_group_id() ORDER BY version DESC LIMIT 1`,
  );
  return {
    intakes: intakes.map(intakeOf),
    children: children.map((child) => ({ id: child.id, name: `${child.given_name} ${child.family_name}` })),
    applications: applications.map((row) => ({
      id: row.id,
      school: { id: row.school_id, name: row.school_name },
      intake: { id: row.intake_id, schoolYear: row.school_year, grade: row.grade },
      childName: fullName(row.child_given, row.child_family),
      status: row.status,
      submittedAt: row.submitted_at.toISOString(),
    })),
    notice: notice ? { id: notice.id, version: notice.version, text: notice.notice_text } : null,
  };
}

export async function submitApplication(
  tx: PersonTransaction,
  body: ApplicationRequestBody,
): Promise<{ id: string; status: 'submitted' }> {
  const [row] = await tx.query<{ id: string }>(
    'SELECT admissions.submit_application($1, $2, $3, $4, $5, $6::date, $7, $8) AS id',
    [
      body.intakeId,
      body.noticeId,
      body.studentId ?? null,
      body.child?.givenName ?? null,
      body.child?.familyName ?? null,
      body.child?.birthDate ?? null,
      body.currentSchool ?? null,
      body.message ?? null,
    ],
  );
  return { id: row!.id, status: 'submitted' };
}

export async function withdrawApplication(tx: PersonTransaction, applicationId: string) {
  await tx.query('SELECT admissions.withdraw_application($1)', [applicationId]);
  return { status: 'withdrawn' as const };
}

export async function reviewApplication(tx: PersonTransaction, applicationId: string) {
  await tx.query('SELECT admissions.review_application($1)', [applicationId]);
  return { status: 'under_review' as const };
}

export async function openIntake(tx: PersonTransaction, body: IntakeRequestBody): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    'SELECT admissions.open_intake($1, $2, $3, $4, $5::date, $6::date) AS id',
    [body.schoolId, body.schoolYear, body.grade, body.places, body.opensOn, body.closesOn],
  );
  return { id: row!.id };
}

export async function closeIntake(tx: PersonTransaction, intakeId: string) {
  await tx.query('SELECT admissions.close_intake($1)', [intakeId]);
  return { status: 'closed' as const };
}

/** Intakes and applications at the schools where the viewer works on admissions. */
export async function schoolApplications(
  tx: PersonTransaction,
  intakeId: string | null,
): Promise<SchoolApplications> {
  const schools = await tx.query<{ id: SchoolId; name: string }>(
    `SELECT id, name FROM org.school
      WHERE group_id = access.current_group_id() AND status = 'active' AND access.has_permission('admissions.manage', id)
      ORDER BY name`,
  );
  const intakes = await tx.query<IntakeRow & { live: number; withdrawn: number }>(
    `SELECT ${INTAKE_COLUMNS},
            (SELECT count(*)::int FROM admissions.application a WHERE a.intake_id = it.id AND a.status <> 'withdrawn') AS live,
            (SELECT count(*)::int FROM admissions.application a WHERE a.intake_id = it.id AND a.status = 'withdrawn') AS withdrawn
       FROM admissions.intake it JOIN org.school s ON s.id = it.school_id
      WHERE access.has_permission('admissions.manage', it.school_id)
      ORDER BY it.status, s.name, it.school_year, it.grade`,
  );
  const applications = await tx.query<{
    id: string;
    school_id: SchoolId;
    school_name: string;
    intake_id: string;
    school_year: string;
    grade: string;
    status: ApplicationStatus;
    child_given: string | null;
    child_family: string | null;
    birth_date: string | null;
    known: boolean;
    current_school: string | null;
    applicant_given: string | null;
    applicant_family: string | null;
    applicant_email: string | null;
    message: string | null;
    notice_version: number;
    submitted_at: Date;
  }>(
    `SELECT a.id, a.school_id, s.name AS school_name, a.intake_id, it.school_year, it.grade, a.status,
            coalesce(c.given_name, a.child_given_name) AS child_given, coalesce(c.family_name, a.child_family_name) AS child_family,
            to_char(coalesce(c.date_of_birth, a.child_birth_date), 'YYYY-MM-DD') AS birth_date,
            a.student_person_id IS NOT NULL AS known, a.current_school,
            ap.given_name AS applicant_given, ap.family_name AS applicant_family, ap.email AS applicant_email,
            a.message, n.version AS notice_version, a.submitted_at
       FROM admissions.application a
       JOIN admissions.intake it ON it.id = a.intake_id
       JOIN org.school s ON s.id = a.school_id
       JOIN admissions.privacy_notice n ON n.id = a.notice_id
       LEFT JOIN people.person c ON c.id = a.student_person_id
       LEFT JOIN people.person ap ON ap.id = a.applicant_person_id
      WHERE access.has_permission('admissions.manage', a.school_id) AND ($1::uuid IS NULL OR a.intake_id = $1)
      ORDER BY a.status = 'withdrawn', a.submitted_at
      LIMIT 500`,
    [intakeId],
  );
  return {
    schools,
    intakes: intakes.map((row) => ({
      ...intakeOf(row),
      applications: { live: row.live, withdrawn: row.withdrawn },
    })),
    applications: applications.map((row) => ({
      id: row.id,
      school: { id: row.school_id, name: row.school_name },
      intake: { id: row.intake_id, schoolYear: row.school_year, grade: row.grade },
      status: row.status,
      child: {
        name: fullName(row.child_given, row.child_family),
        birthDate: row.birth_date,
        known: row.known,
        currentSchool: row.current_school,
      },
      applicant: { name: fullName(row.applicant_given, row.applicant_family), email: row.applicant_email },
      message: row.message,
      noticeVersion: row.notice_version,
      submittedAt: row.submitted_at.toISOString(),
    })),
  };
}

/** Invites an inquiry's sender to apply: the parent's person record, created once (ADR 0027). */
export async function inviteApplicant(
  tx: PersonTransaction,
  inquiryId: string,
  name: { givenName: string; familyName: string },
): Promise<{ personId: string; email: string; givenName: string; familyName: string; hasLogin: boolean }> {
  const [row] = await tx.query<{ person_id: string; email: string; has_login: boolean }>(
    'SELECT person_id, email, has_login FROM admissions.invite_applicant($1, $2, $3)',
    [inquiryId, name.givenName, name.familyName],
  );
  const [person] = await tx.query<{ given_name: string; family_name: string }>(
    'SELECT given_name, family_name FROM people.person WHERE id = $1',
    [row!.person_id],
  );
  return {
    personId: row!.person_id,
    email: row!.email,
    givenName: person?.given_name ?? name.givenName,
    familyName: person?.family_name ?? name.familyName,
    hasLogin: row!.has_login,
  };
}

export async function linkApplicantLogin(tx: PersonTransaction, personId: string, subject: string) {
  await tx.query('SELECT admissions.link_applicant_login($1, $2)', [personId, subject]);
}
