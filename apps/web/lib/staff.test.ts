import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import {
  checkBody,
  employmentBody,
  qualificationBody,
  shiftSchoolYear,
  trainingBody,
  workingTimeLabel,
} from './staff';

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const filled = {
  person_id: 'c1000000-0000-7000-8000-000000000009',
  employer_id: 'b2000000-0000-7000-8000-000000000001',
  position: 'Cook',
  contract_kind: 'permanent',
  working_time: '75',
  start_date: '2026-09-01',
};

describe('the employment form', () => {
  it('reads working time as a percentage and leaves out what is empty', () => {
    expect(employmentBody(form({ ...filled, work_phone: '+359 888 000 001' }))).toEqual({
      personId: filled.person_id,
      employerId: filled.employer_id,
      position: 'Cook',
      contractKind: 'permanent',
      workingTime: 0.75,
      startDate: '2026-09-01',
      workPhone: '+359888000001',
    });
  });

  it('asks for the person, the position, a working time and dates in order', () => {
    const problem = (fields: Record<string, string>) => () => employmentBody(form({ ...filled, ...fields }));
    expect(problem({ person_id: '' })).toThrow(FormProblem);
    expect(problem({ position: '' })).toThrow(FormProblem);
    expect(problem({ working_time: '120' })).toThrow(FormProblem);
    expect(problem({ end_date: '2026-08-01' })).toThrow(FormProblem);
    expect(problem({ contract_kind: 'fixed_term' })).toThrow('end date');
  });

  it('says full time or a share of it', () => {
    expect(workingTimeLabel(1)).toBe('full time');
    expect(workingTimeLabel(0.75)).toBe('75% of full time');
  });
});

describe('qualifications and checks in the portal', () => {
  it('reads a qualification and an expiry after the award', () => {
    expect(
      qualificationBody(
        form({ kind: 'first_aid', title: 'First aid', awarded_on: '2026-01-10', expires_on: '2029-01-10' }),
      ),
    ).toEqual({
      kind: 'first_aid',
      title: 'First aid',
      awardedOn: '2026-01-10',
      expiresOn: '2029-01-10',
    });
    expect(() =>
      qualificationBody(
        form({ kind: 'first_aid', title: 'x', awarded_on: '2026-01-10', expires_on: '2025-01-10' }),
      ),
    ).toThrow(FormProblem);
    expect(() => qualificationBody(form({ kind: 'charm', title: 'x', awarded_on: '2026-01-10' }))).toThrow(
      FormProblem,
    );
  });

  it('reads only the dates of a record check', () => {
    expect(checkBody(form({ seen_on: '2026-10-01', valid_until: '2027-04-01', outcome: 'clear' }))).toEqual({
      seenOn: '2026-10-01',
      validUntil: '2027-04-01',
    });
    expect(() => checkBody(form({ seen_on: '2026-10-01', valid_until: '2026-09-01' }))).toThrow(FormProblem);
  });
});

describe('professional development in the portal', () => {
  it('reads training in half hours, one day when no end is given', () => {
    expect(
      trainingBody(
        form({
          title: 'Workshop',
          kind: 'workshop',
          starts_on: '2026-10-05',
          hours: '3,5',
          status: 'attended',
        }),
      ),
    ).toEqual({
      title: 'Workshop',
      kind: 'workshop',
      startsOn: '2026-10-05',
      endsOn: '2026-10-05',
      hours: 3.5,
      status: 'attended',
    });
    expect(() =>
      trainingBody(form({ title: 'x', kind: 'workshop', starts_on: '2026-10-05', hours: '3.3' })),
    ).toThrow(FormProblem);
    expect(() =>
      trainingBody(
        form({ title: 'x', kind: 'workshop', starts_on: '2026-10-05', ends_on: '2026-10-01', hours: '2' }),
      ),
    ).toThrow(FormProblem);
  });

  it('moves between school years', () => {
    expect(shiftSchoolYear('2026/27', -1)).toBe('2025/26');
    expect(shiftSchoolYear('2099/00', 1)).toBe('2100/01');
  });
});
