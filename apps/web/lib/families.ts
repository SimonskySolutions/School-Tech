import { type Form, FormProblem, text } from './admin';

// The students and families page for school staff (principals, school
// administrators, teachers): plain functions from its forms to API requests,
// so they are tested without a browser. The API and the database decide who
// may do what; teachers only see the list.

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const RELATIONSHIPS: Record<string, string> = {
  mother: 'Mother',
  father: 'Father',
  parent: 'Parent',
  legal_guardian: 'Legal guardian',
  foster_carer: 'Foster carer',
  other: 'Other',
};

export function enrolBody(form: Form) {
  const dateOfBirth = text(form, 'date_of_birth');
  if (dateOfBirth && !DAY.test(dateOfBirth)) throw new FormProblem('the date of birth is not a date');
  return {
    givenName: text(form, 'given_name'),
    familyName: text(form, 'family_name'),
    ...(dateOfBirth ? { dateOfBirth } : {}),
    academicYear: text(form, 'academic_year'),
    ...(text(form, 'grade_level') ? { gradeLevel: text(form, 'grade_level') } : {}),
    ...(text(form, 'class_label') ? { classLabel: text(form, 'class_label') } : {}),
    startDate: text(form, 'start_date'),
  };
}

/** A checkbox is on when the form sends it at all. */
const checked = (form: Form, name: string) => form.get(name) !== null;

export function guardianBody(form: Form) {
  const givenName = text(form, 'given_name');
  const familyName = text(form, 'family_name');
  return {
    email: text(form, 'email').toLowerCase(),
    ...(givenName ? { givenName } : {}),
    ...(familyName ? { familyName } : {}),
    relationship: text(form, 'relationship') || 'parent',
    canPay: checked(form, 'can_pay'),
    canManageBookings: checked(form, 'can_manage_bookings'),
    canConsent: checked(form, 'can_consent'),
  };
}

/** The school year a date falls in: September to August, as "2026/2027". */
export function academicYearOf(date: Date): string {
  const year = date.getUTCMonth() >= 8 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
  return `${year}/${year + 1}`;
}

export const DONE: Record<string, string> = {
  'enrol-student': 'Student enrolled. Record their parents or guardians below.',
  'add-guardian': 'Guardian recorded and verified. They see the child when they next sign in.',
};
