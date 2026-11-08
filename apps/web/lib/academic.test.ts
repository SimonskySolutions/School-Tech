import { describe, expect, it } from 'vitest';
import { gradeBody, readDay, registerBody } from './academic';

describe('the register form', () => {
  it('reads one mark per child', () => {
    const form = new FormData();
    form.set('day', '2026-11-05');
    form.set('status:a', 'present');
    form.set('status:b', 'absent');
    expect(registerBody(form)).toEqual({
      day: '2026-11-05',
      marks: [
        { studentId: 'a', status: 'present' },
        { studentId: 'b', status: 'absent' },
      ],
    });
  });

  it('asks for at least one mark', () => {
    const form = new FormData();
    form.set('day', '2026-11-05');
    expect(() => registerBody(form)).toThrow('mark at least one child');
  });
});

describe('the grade form', () => {
  const form = (value: string) => {
    const fields = new FormData();
    fields.set('student_id', 'a');
    fields.set('subject', 'Maths');
    fields.set('term', '1');
    fields.set('value', value);
    return fields;
  };

  it('keeps to the 2 to 6 scale', () => {
    expect(gradeBody(form('6')).value).toBe(6);
    expect(() => gradeBody(form('7'))).toThrow('grades go from 2 to 6');
  });
});

describe('the day shown', () => {
  it('is today unless a date was asked for', () => {
    expect(readDay('2026-10-01', '2026-11-05')).toBe('2026-10-01');
    expect(readDay('soon', '2026-11-05')).toBe('2026-11-05');
  });
});
