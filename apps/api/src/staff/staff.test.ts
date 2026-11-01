import { describe, expect, it } from 'vitest';
import { employmentSchema, endSchema } from './staff.controller';
import { mismatchOf } from './staff.repository';

const valid = {
  personId: 'c1000000-0000-7000-8000-000000000009',
  employerId: 'b2000000-0000-7000-8000-000000000001',
  position: ' Cook ',
  contractKind: 'permanent',
  workingTime: 0.5,
  startDate: '2026-09-01',
};

describe('employments', () => {
  it('takes the employment fields and nothing that belongs to payroll', () => {
    expect(employmentSchema.parse({ ...valid, workEmail: 'Cook@School.test' })).toMatchObject({
      position: 'Cook',
      workEmail: 'cook@school.test',
    });
    expect(employmentSchema.safeParse({ ...valid, salary: 2000 }).success).toBe(false);
    expect(employmentSchema.safeParse({ ...valid, nationalId: '0000000000' }).success).toBe(false);
    expect(employmentSchema.safeParse({ ...valid, homeAddress: 'x' }).success).toBe(false);
  });

  it('checks working time, dates and fixed terms', () => {
    expect(employmentSchema.safeParse({ ...valid, workingTime: 1.2 }).success).toBe(false);
    expect(employmentSchema.safeParse({ ...valid, workingTime: 0 }).success).toBe(false);
    expect(employmentSchema.safeParse({ ...valid, endDate: '2026-08-31' }).success).toBe(false);
    expect(employmentSchema.safeParse({ ...valid, contractKind: 'fixed_term' }).success).toBe(false);
    expect(
      employmentSchema.safeParse({ ...valid, contractKind: 'fixed_term', endDate: '2027-08-31' }).success,
    ).toBe(true);
    expect(employmentSchema.safeParse({ ...valid, workPhone: '0888 123 456' }).success).toBe(false);
    expect(endSchema.safeParse({ endDate: '31.08.2027' }).success).toBe(false);
  });

  it('shows where access and employment disagree', () => {
    expect(mismatchOf(['teacher'], [])).toBe('role_without_employment');
    expect(mismatchOf(['teacher'], [{ current: false }])).toBe('role_without_employment');
    expect(mismatchOf([], [{ current: true }])).toBe('employment_without_role');
    expect(mismatchOf(['teacher'], [{ current: true }])).toBeNull();
    expect(mismatchOf([], [{ current: false }])).toBeNull();
  });
});
