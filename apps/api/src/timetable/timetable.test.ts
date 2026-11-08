import { describe, expect, it } from 'vitest';
import { entrySchema, periodSchema } from './timetable.controller';
import { academicYearOf, refusalsAsTimetable, TimetableRejected } from './timetable.repository';

const id = '019a0000-0000-7000-8000-000000000001';

describe('the school year', () => {
  it('turns over in August', () => {
    expect(academicYearOf(new Date('2026-11-05'))).toBe('2026/2027');
    expect(academicYearOf(new Date('2027-06-30'))).toBe('2026/2027');
    expect(academicYearOf(new Date('2027-08-01'))).toBe('2027/2028');
  });
});

describe('timetable forms', () => {
  it('keeps lessons to school days', () => {
    const lesson = { classId: id, periodId: id, teacherId: id, roomId: id, subject: 'Maths' };
    expect(entrySchema.safeParse({ ...lesson, weekday: 5 }).success).toBe(true);
    expect(entrySchema.safeParse({ ...lesson, weekday: 6 }).success).toBe(false);
  });

  it('refuses a period that ends before it starts', () => {
    expect(periodSchema.safeParse({ position: 1, starts: '09:00', ends: '08:15' }).success).toBe(false);
  });
});

describe('database refusals', () => {
  const refused = (error: object) =>
    refusalsAsTimetable(() => Promise.reject(Object.assign(new Error('db'), error)));

  it('says which promise a clash breaks', async () => {
    await expect(refused({ code: '23505', constraint: 'timetable_teacher_free' })).rejects.toMatchObject({
      status: 409,
      message: 'this teacher already teaches in that period',
    });
  });

  it('answers a full class as a conflict', async () => {
    await expect(refused({ code: 'PY027' })).rejects.toBeInstanceOf(TimetableRejected);
    await expect(refused({ code: 'PY027' })).rejects.toMatchObject({ status: 409 });
  });

  it('lets anything else through', async () => {
    await expect(refused({ code: 'XX000' })).rejects.toThrow('db');
  });
});
