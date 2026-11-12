import { type AttendanceStatus } from '@pythagoras/shared';
import { FormProblem, text } from './admin';

// Register and grade forms, as plain functions tested without a browser. The
// API and the database check everything again.

export const ATTENDANCE_NAMES: Record<AttendanceStatus, string> = {
  present: 'Present',
  late: 'Late',
  absent: 'Absent',
  excused: 'Excused',
};

export const ACADEMIC_NOTICES: Record<string, string> = {
  saved: 'Register saved.',
  grade: 'Grade added.',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The day a page shows, today unless a real date was asked for. */
export const readDay = (value: unknown, today: string): string =>
  typeof value === 'string' && DAY.test(value) ? value : today;

/** The register form has one radio group per child, named `status:<child>`. */
export function registerBody(form: Pick<FormData, 'get' | 'entries'>) {
  const day = text(form, 'day');
  if (!DAY.test(day)) throw new FormProblem('choose a day');
  const marks = [...form.entries()]
    .filter(([name]) => name.startsWith('status:'))
    .map(([name, value]) => ({ studentId: name.slice(7), status: String(value) as AttendanceStatus }));
  if (marks.length === 0) throw new FormProblem('mark at least one child');
  return { day, marks };
}

export function gradeBody(form: Pick<FormData, 'get'>) {
  const subject = text(form, 'subject');
  const term = Number(text(form, 'term'));
  const value = Number(text(form, 'value'));
  if (!subject || subject.length > 80) throw new FormProblem('give the subject');
  if (term !== 1 && term !== 2) throw new FormProblem('choose the term');
  if (!Number.isInteger(value) || value < 2 || value > 6) throw new FormProblem('grades go from 2 to 6');
  return { studentId: text(form, 'student_id'), subject, term, value };
}

/** How a grade reads: the Bulgarian words for 2 to 6. */
export const GRADE_NAMES: Record<number, string> = {
  2: 'Poor',
  3: 'Fair',
  4: 'Good',
  5: 'Very good',
  6: 'Excellent',
};
