import { type MeResponse, type SchoolSummary } from '@pythagoras/shared';

// What the home page shows, derived from what the API says about the person.
// A person can be several things at once (a teacher who is also a parent).

export interface HomeView {
  greeting: string;
  children: { id: string; name: string; places: string[] }[];
  schoolRoles: { role: string; school: string }[];
  groupRoles: string[];
  groupSchools: string[];
  hasNothing: boolean;
}

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
    .map((role) => ({ role: role.name, school: role.school!.name }));

  return {
    greeting: `Hello, ${me.person.preferredName ?? me.person.givenName}`,
    children,
    schoolRoles,
    groupRoles,
    groupSchools: groupRoles.length > 0 ? schools.map((school) => school.name) : [],
    hasNothing: children.length === 0 && schoolRoles.length === 0 && groupRoles.length === 0,
  };
}

export const NOTICES: Record<string, string> = {
  'signed-out': 'You have signed out.',
  'sign-in-expired': 'Signing in took too long. Please try again.',
  'sign-in-failed': 'Signing in did not complete. Please try again.',
};
