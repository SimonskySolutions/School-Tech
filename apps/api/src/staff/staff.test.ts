import { describe, expect, it } from 'vitest';
import {
  checkSchema,
  employmentSchema,
  endSchema,
  qualificationSchema,
  trainingSchema,
  trainingStatusSchema,
} from './staff.controller';
import { attentionFor, expiryState, mismatchOf, trainingHours } from './staff.repository';

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

describe('qualifications and checks', () => {
  const TODAY = '2026-11-01';

  it('calls an end within 60 days expiring, and a past one expired', () => {
    expect(expiryState(null, TODAY)).toBe('valid');
    expect(expiryState('2026-10-31', TODAY)).toBe('expired');
    expect(expiryState('2026-11-01', TODAY)).toBe('expiring');
    expect(expiryState('2026-12-31', TODAY)).toBe('expiring');
    expect(expiryState('2027-01-01', TODAY)).toBe('valid');
  });

  it('asks for a valid check for everyone employed, and a licence for teachers', () => {
    const employed = { roles: ['teacher'], employments: [{ current: true }] };
    const licence = {
      id: 'q',
      kind: 'teaching_licence' as const,
      title: 'Licence',
      issuer: null,
      awardedOn: '2020-01-01',
      expiresOn: null,
      state: 'valid' as const,
    };
    const check = (state: 'valid' | 'expiring' | 'expired') => ({
      seenOn: '2026-06-01',
      validUntil: '2026-12-01',
      seenBy: null,
      state,
    });
    expect(attentionFor(employed, [], null)).toEqual(['check_missing', 'licence_missing']);
    expect(attentionFor(employed, [licence], check('valid'))).toEqual([]);
    expect(attentionFor(employed, [licence], check('expiring'))).toEqual(['check_expiring']);
    expect(attentionFor(employed, [{ ...licence, state: 'expired' }], check('expired'))).toEqual([
      'check_expired',
      'licence_missing',
      'qualification_expired',
    ]);
    // Without a current employment there is nobody to check yet.
    expect(attentionFor({ roles: ['kitchen'], employments: [] }, [], null)).toEqual([]);
  });

  it('takes a qualification and a check with nothing beyond their dates', () => {
    expect(
      qualificationSchema.safeParse({
        kind: 'first_aid',
        title: 'First aid',
        awardedOn: '2026-01-01',
        expiresOn: '2028-01-01',
      }).success,
    ).toBe(true);
    expect(
      qualificationSchema.safeParse({
        kind: 'first_aid',
        title: 'First aid',
        awardedOn: '2026-01-01',
        expiresOn: '2025-01-01',
      }).success,
    ).toBe(false);
    expect(checkSchema.safeParse({ seenOn: '2026-10-01', validUntil: '2027-04-01' }).success).toBe(true);
    expect(
      checkSchema.safeParse({ seenOn: '2026-10-01', validUntil: '2027-04-01', outcome: 'clear' }).success,
    ).toBe(false);
    expect(
      checkSchema.safeParse({ seenOn: '2026-10-01', validUntil: '2027-04-01', certificate: 'scan' }).success,
    ).toBe(false);
  });
});

describe('professional development', () => {
  it('adds up attended and planned hours, leaving cancelled training out', () => {
    expect(
      trainingHours([
        { hours: 8, status: 'attended' },
        { hours: 2.5, status: 'attended' },
        { hours: 12, status: 'planned' },
        { hours: 6, status: 'cancelled' },
      ]),
    ).toEqual({ attended: 10.5, planned: 12 });
    expect(trainingHours([])).toEqual({ attended: 0, planned: 0 });
  });

  it('takes training in half hours, planned or attended, ending after it starts', () => {
    const training = {
      title: 'Course',
      kind: 'course',
      startsOn: '2026-10-01',
      endsOn: '2026-10-02',
      hours: 7.5,
      status: 'attended',
    };
    expect(trainingSchema.safeParse(training).success).toBe(true);
    expect(trainingSchema.safeParse({ ...training, hours: 7.3 }).success).toBe(false);
    expect(trainingSchema.safeParse({ ...training, endsOn: '2026-09-30' }).success).toBe(false);
    expect(trainingSchema.safeParse({ ...training, status: 'cancelled' }).success).toBe(false);
    expect(trainingStatusSchema.safeParse({ status: 'planned' }).success).toBe(false);
  });
});
