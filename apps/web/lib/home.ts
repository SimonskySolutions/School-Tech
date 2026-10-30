import { type MeResponse, type SchoolSummary } from '@pythagoras/shared';

// What the home page shows, derived from what the API says about the person.
// A person can be several things at once (a teacher who is also a parent).

export interface HomeView {
  greeting: string;
  children: { id: string; name: string; places: string[] }[];
  /** studentsHref: the school's students page, for roles that can read enrolments there. */
  schoolRoles: { role: string; school: string; studentsHref: string | null }[];
  groupRoles: string[];
  groupSchools: string[];
  /** Kitchen counts and club registers; the API decides what each role sees there. */
  showsSchoolLife: boolean;
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
    }));

  return {
    greeting: `Hello, ${me.person.preferredName ?? me.person.givenName}`,
    children,
    schoolRoles,
    groupRoles,
    groupSchools: groupRoles.length > 0 ? schools.map((school) => school.name) : [],
    showsSchoolLife: me.roles.some((role) => SCHOOL_LIFE_ROLES.has(role.code)),
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
