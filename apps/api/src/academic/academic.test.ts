import { describe, expect, it } from 'vitest';
import { gradeSchema, registerSchema } from './academic.controller';
import { average, refusalsAsAcademic } from './academic.repository';

const id = '019a0000-0000-7000-8000-000000000001';

describe('grades', () => {
  it('averages to two places, and has no average without grades', () => {
    expect(average([6, 5, 5])).toBe(5.33);
    expect(average([])).toBeNull();
  });

  it('keeps to the 2 to 6 scale', () => {
    expect(gradeSchema.safeParse({ studentId: id, subject: 'Maths', term: 1, value: 6 }).success).toBe(true);
    expect(gradeSchema.safeParse({ studentId: id, subject: 'Maths', term: 1, value: 1 }).success).toBe(false);
  });
});

describe('the register', () => {
  it('takes only the four marks', () => {
    const marks = (status: string) => ({ day: '2026-11-05', marks: [{ studentId: id, status }] });
    expect(registerSchema.safeParse(marks('late')).success).toBe(true);
    expect(registerSchema.safeParse(marks('asleep')).success).toBe(false);
  });

  it('says plainly when a child is not in the class', async () => {
    const refused = Object.assign(new Error('db'), { code: 'PY029' });
    await expect(refusalsAsAcademic(() => Promise.reject(refused))).rejects.toMatchObject({
      status: 422,
      message: 'this child is not in this class',
    });
  });
});
