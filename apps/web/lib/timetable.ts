import { type TimetableEntry, type TimetableView } from '@pythagoras/shared';
import { type Form, FormProblem, text } from './admin';

// Class and timetable forms and notices, as plain functions tested without a
// browser. The API and the database check everything again.

export const SCHOOL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export const TIMETABLE_NOTICES: Record<string, string> = {
  class: 'Class added.',
  changed: 'Class updated.',
  placed: 'Child placed in the class.',
  period: 'Period added.',
  lesson: 'Lesson added.',
  removed: 'Lesson removed.',
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const VIEWS: readonly TimetableView[] = ['class', 'teacher', 'room'];

export const readView = (value: unknown): TimetableView => VIEWS.find((view) => view === value) ?? 'class';

/** How full a class is, for its badge and meter. */
export function seats(taken: number, capacity: number) {
  const left = Math.max(capacity - taken, 0);
  return {
    left,
    percent: Math.min(Math.round((taken / capacity) * 100), 100),
    state: left === 0 ? ('full' as const) : left <= 2 ? ('warn' as const) : ('ok' as const),
  };
}

/** The colour of a subject: the same everywhere, so a week reads at a glance. */
export function subjectTone(subject: string): number {
  let sum = 0;
  for (const letter of subject.toLowerCase()) sum += letter.codePointAt(0) ?? 0;
  return (sum % 6) + 1;
}

/** The lesson in a cell of the week, if there is one. */
export const lessonAt = (entries: readonly TimetableEntry[], weekday: number, periodId: string) =>
  entries.find((entry) => entry.weekday === weekday && entry.periodId === periodId) ?? null;

const optional = (form: Form, name: string): string | null => text(form, name) || null;

function capacity(form: Form): number {
  const value = Number(text(form, 'capacity'));
  if (!Number.isInteger(value) || value < 1 || value > 60) {
    throw new FormProblem('a class has 1 to 60 places');
  }
  return value;
}

export function classBody(form: Form) {
  const label = text(form, 'label');
  const gradeLevel = text(form, 'grade_level');
  if (!label || label.length > 40) throw new FormProblem('give the class a name, like 3A');
  if (!gradeLevel || gradeLevel.length > 40) throw new FormProblem('give the grade, like 3');
  return {
    label,
    gradeLevel,
    capacity: capacity(form),
    formTeacherId: optional(form, 'form_teacher_id'),
    homeRoomId: optional(form, 'home_room_id'),
  };
}

export function classChangeBody(form: Form) {
  return {
    capacity: capacity(form),
    formTeacherId: optional(form, 'form_teacher_id'),
    homeRoomId: optional(form, 'home_room_id'),
  };
}

export function periodBody(form: Form) {
  const position = Number(text(form, 'position'));
  const starts = text(form, 'starts');
  const ends = text(form, 'ends');
  if (!Number.isInteger(position) || position < 1 || position > 12) {
    throw new FormProblem('periods are numbered 1 to 12');
  }
  if (!CLOCK.test(starts) || !CLOCK.test(ends)) throw new FormProblem('times are like 08:30');
  if (starts >= ends) throw new FormProblem('the end is before the start');
  return { position, starts, ends };
}

export function entryBody(form: Form) {
  const weekday = Number(text(form, 'weekday'));
  const subject = text(form, 'subject');
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 5) throw new FormProblem('choose a school day');
  if (!subject || subject.length > 80) throw new FormProblem('give the subject');
  return {
    classId: text(form, 'class_id'),
    weekday,
    periodId: text(form, 'period_id'),
    subject,
    teacherId: text(form, 'teacher_id'),
    roomId: text(form, 'room_id'),
  };
}
