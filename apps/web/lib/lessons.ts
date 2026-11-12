import { type Form, FormProblem, text } from './admin';

// Lesson forms and notices (M4.3, ADR 0022), as plain functions tested
// without a browser. The API and the database check everything again.

export const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const LESSON_NOTICES: Record<string, string> = {
  booked: 'Lesson booked. One lesson of the package is used for it.',
  'cancelled-returned': 'Lesson cancelled. It is back in the package.',
  'cancelled-used': 'Lesson cancelled. It was after the cutoff, so it counts as used.',
  resource: 'Added.',
  hours: 'Hours added.',
  'hours-removed': 'Hours removed. Slots already created stay.',
};

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function resourceBody(form: Form): { kind: 'teacher' | 'room'; displayName: string } {
  const kind = text(form, 'kind');
  if (kind !== 'teacher' && kind !== 'room') throw new FormProblem('choose a teacher or a room');
  const displayName = text(form, 'display_name');
  if (!displayName || displayName.length > 120) throw new FormProblem('give a name of up to 120 characters');
  return { kind, displayName };
}

export function hoursBody(form: Form): { weekday: number; starts: string; ends: string } {
  const weekday = Number(text(form, 'weekday'));
  const starts = text(form, 'starts');
  const ends = text(form, 'ends');
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) throw new FormProblem('choose a weekday');
  if (!CLOCK.test(starts) || !CLOCK.test(ends)) throw new FormProblem('times are like 14:00');
  if (starts >= ends) throw new FormProblem('the end is before the start');
  return { weekday, starts, ends };
}

export function slotsBody(form: Form) {
  const from = text(form, 'from');
  const to = text(form, 'to');
  const minutes = Number(text(form, 'minutes'));
  if (!DAY.test(from) || !DAY.test(to) || from > to)
    throw new FormProblem('choose a first and a last day in order');
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240) {
    throw new FormProblem('a lesson lasts 15 to 240 minutes');
  }
  return {
    offeringId: text(form, 'offering_id'),
    teacherId: text(form, 'teacher_id'),
    roomId: text(form, 'room_id'),
    from,
    to,
    minutes,
  };
}
