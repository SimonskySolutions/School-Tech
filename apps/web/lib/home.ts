import { type MeResponse, type SchoolSummary } from '@pythagoras/shared';

// What the home page shows, derived from what the API says about the person.
// A person can be several things at once (a teacher who is also a parent).

export interface HomeView {
  greeting: string;
  children: { id: string; name: string; places: string[] }[];
  /** studentsHref: the school's students page, for roles that can read enrolments there. */
  schoolRoles: {
    role: string;
    school: string;
    studentsHref: string | null;
    lessonsHref: string | null;
    uniformsHref: string | null;
    /** The school's staff records, for roles with staff.read there (M6.1). */
    staffHref: string | null;
    /** The school's documents (M6.4): every school role may read those for all staff. */
    documentsHref: string;
    /** Who may appear in photos (M6.6), for roles that read the school's enrolments. */
    consentsHref: string | null;
  }[];
  groupRoles: string[];
  groupSchools: string[];
  /** Kitchen counts and club registers; the API decides what each role sees there. */
  showsSchoolLife: boolean;
  /** Children's dietary needs to verify (dietary and enrolment read); the API enforces it. */
  showsDietaryReview: boolean;
  /** Families' requests (requests.manage); the API enforces it. */
  showsRequests: boolean;
  /** Inquiries from school websites (admissions.manage); the API enforces it. */
  showsAdmissions: boolean;
  /** Admissions numbers per school without names (admissions.report); the API enforces it. */
  showsAdmissionsReport: boolean;
  /** Group roles that see School Life: the lessons page of each school. */
  lessonSchools: { id: string; name: string }[];
  /** Group roles that read staff records: each school's staff and documents pages. */
  staffSchools: { id: string; name: string }[];
  /** Group roles that read enrolments: each school's photo consents (M6.6). */
  consentSchools: { id: string; name: string }[];
  /** The data protection officer publishes consent wording (M6.6). */
  showsConsentWording: boolean;
  /** Group finance exports each company's ledger (M7.4). */
  showsAccounting: boolean;
  /** Anyone with a role sees their own employment records. */
  showsMyEmployment: boolean;
  /** Roles that approve document versions (M6.5); the API decides which steps are theirs. */
  showsApprovals: boolean;
  /** Revenue and balances per school; the API decides which schools. */
  showsReports: boolean;
  /** Setting up schools (org.manage); the API enforces it. */
  showsSchoolSetup: boolean;
  hasNothing: boolean;
}

// Roles that hold bookings.read in the database (access.role_permission). Only
// a hint for which links to show: the API enforces the permission itself.
const SCHOOL_LIFE_ROLES = new Set([
  'group_ceo',
  'group_admin',
  'group_finance',
  'school_life_coordinator',
  'principal',
  'school_admin',
  'teacher',
  'kitchen',
]);

// Roles that hold sensitive.dietary.read and enrolment.read; a hint for links only.
const DIETARY_REVIEW_ROLES = new Set(['school_life_coordinator', 'principal']);

// Roles that hold requests.manage; a hint for links only.
const REQUEST_ROLES = new Set(['school_life_coordinator', 'principal', 'school_admin']);

// Roles that hold staff.read (school roles at their school, group roles everywhere); a hint for links only.
const STAFF_ROLES = new Set(['principal', 'school_admin', 'group_admin', 'group_ceo']);

// Roles that may be asked to approve a document version (documents.approval_step).
const APPROVER_ROLES = new Set(['principal', 'school_admin', 'group_admin', 'group_ceo']);

// Group roles that hold enrolment.read everywhere; a hint for links only.
const GROUP_ENROLMENT_ROLES = new Set([
  'group_ceo',
  'group_admin',
  'group_finance',
  'school_life_coordinator',
]);

// Roles that hold admissions.manage; a hint for links only.
const ADMISSIONS_ROLES = new Set(['principal', 'school_admin', 'group_admin']);

// Roles that hold admissions.report; a hint for links only.
const ADMISSIONS_REPORT_ROLES = new Set(['group_ceo']);

// Roles that hold reports.read in the database; again only a hint for links.
const REPORT_ROLES = new Set([
  'group_ceo',
  'group_admin',
  'group_finance',
  'school_life_coordinator',
  'principal',
]);

// School roles that hold enrolment.read at their school (access.role_permission); a hint for links only.
const STUDENT_ROLES = new Set(['principal', 'school_admin', 'teacher']);

// Roles that hold org.manage; adding offerings also needs catalog.manage, which only the administrator has.
const SETUP_ROLES = new Set(['group_admin', 'group_ceo']);

export function buildHome(me: MeResponse, schools: readonly SchoolSummary[]): HomeView {
  const groupRoles = me.roles.filter((role) => role.scope === 'group').map((role) => role.name);
  const children = me.children.map((child) => ({
    id: child.id,
    name: `${child.givenName} ${child.familyName}`,
    places: child.enrolments.map((enrolment) =>
      [enrolment.school.name, enrolment.classLabel ? `class ${enrolment.classLabel}` : null]
        .filter(Boolean)
        .join(', '),
    ),
  }));
  const schoolRoles = me.roles
    .filter((role) => role.scope === 'school' && role.school)
    .map((role) => ({
      role: role.name,
      school: role.school!.name,
      studentsHref: STUDENT_ROLES.has(role.code) ? `/schools/${role.school!.id}/students` : null,
      // Every school role holds bookings.read or catalog.read there (access.role_permission).
      lessonsHref: `/schools/${role.school!.id}/lessons`,
      uniformsHref: `/schools/${role.school!.id}/uniforms`,
      staffHref: STAFF_ROLES.has(role.code) ? `/schools/${role.school!.id}/staff` : null,
      documentsHref: `/schools/${role.school!.id}/documents`,
      consentsHref: STUDENT_ROLES.has(role.code) ? `/schools/${role.school!.id}/consents` : null,
    }));

  return {
    greeting: `Hello, ${me.person.preferredName ?? me.person.givenName}`,
    children,
    schoolRoles,
    groupRoles,
    groupSchools: groupRoles.length > 0 ? schools.map((school) => school.name) : [],
    showsSchoolLife: me.roles.some((role) => SCHOOL_LIFE_ROLES.has(role.code)),
    showsDietaryReview: me.roles.some((role) => DIETARY_REVIEW_ROLES.has(role.code)),
    showsRequests: me.roles.some((role) => REQUEST_ROLES.has(role.code)),
    showsAdmissions: me.roles.some((role) => ADMISSIONS_ROLES.has(role.code)),
    showsAdmissionsReport: me.roles.some((role) => ADMISSIONS_REPORT_ROLES.has(role.code)),
    lessonSchools: me.roles.some((role) => role.scope === 'group' && SCHOOL_LIFE_ROLES.has(role.code))
      ? schools.map((school) => ({ id: school.id, name: school.name }))
      : [],
    staffSchools: me.roles.some((role) => role.scope === 'group' && STAFF_ROLES.has(role.code))
      ? schools.map((school) => ({ id: school.id, name: school.name }))
      : [],
    consentSchools: me.roles.some((role) => role.scope === 'group' && GROUP_ENROLMENT_ROLES.has(role.code))
      ? schools.map((school) => ({ id: school.id, name: school.name }))
      : [],
    showsConsentWording: me.roles.some((role) => role.code === 'privacy_officer'),
    showsAccounting: me.roles.some((role) => role.code === 'group_finance'),
    showsMyEmployment: me.roles.length > 0,
    showsApprovals: me.roles.some((role) => APPROVER_ROLES.has(role.code)),
    showsReports: me.roles.some((role) => REPORT_ROLES.has(role.code)),
    showsSchoolSetup: me.roles.some((role) => SETUP_ROLES.has(role.code)),
    hasNothing: children.length === 0 && schoolRoles.length === 0 && groupRoles.length === 0,
  };
}

export const NOTICES: Record<string, string> = {
  'signed-out': 'You have signed out.',
  'sign-in-expired': 'Signing in took too long. Please try again.',
  'sign-in-failed': 'Signing in did not complete. Please try again.',
};
