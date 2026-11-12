import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { classBody, entryBody, lessonAt, periodBody, readView, seats, subjectTone } from './timetable';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('seats', () => {
  it('warns when two places are left and stops at full', () => {
    expect(seats(10, 24)).toEqual({ left: 14, percent: 42, state: 'ok' });
    expect(seats(22, 24).state).toBe('warn');
    expect(seats(24, 24)).toEqual({ left: 0, percent: 100, state: 'full' });
  });
});

describe('subject colours', () => {
  it('gives a subject one colour, whatever its case', () => {
    expect(subjectTone('Maths')).toBe(subjectTone('MATHS'));
    expect(subjectTone('Maths')).toBeGreaterThanOrEqual(1);
    expect(subjectTone('Maths')).toBeLessThanOrEqual(6);
  });
});

describe('timetable views', () => {
  it('falls back to the class view', () => {
    expect(readView('teacher')).toBe('teacher');
    expect(readView('nonsense')).toBe('class');
    expect(readView(undefined)).toBe('class');
  });
});

describe('the week', () => {
  it('finds the lesson in a cell', () => {
    const lesson = { weekday: 2, periodId: 'p1' } as never;
    expect(lessonAt([lesson], 2, 'p1')).toBe(lesson);
    expect(lessonAt([lesson], 3, 'p1')).toBeNull();
  });
});

describe('forms', () => {
  it('reads a class, with no teacher or room yet', () => {
    expect(classBody(form({ label: '3A', grade_level: '3', capacity: '24' }))).toEqual({
      label: '3A',
      gradeLevel: '3',
      capacity: 24,
      formTeacherId: null,
      homeRoomId: null,
    });
  });

  it('refuses a class of no size', () => {
    expect(() => classBody(form({ label: '3A', grade_level: '3', capacity: '0' }))).toThrow(FormProblem);
  });

  it('refuses a period that ends before it starts', () => {
    expect(() => periodBody(form({ position: '1', starts: '09:00', ends: '08:15' }))).toThrow(
      'the end is before the start',
    );
  });

  it('keeps lessons to school days', () => {
    expect(() => entryBody(form({ weekday: '6', subject: 'Maths' }))).toThrow('choose a school day');
  });
});
