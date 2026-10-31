import { describe, expect, it } from 'vitest';
import {
  answerSchema,
  applicationNoteSchema,
  applicationSchema,
  decisionSchema,
  intakeSchema,
  inviteSchema,
  offerSchema,
} from './applications.controller';

const INTAKE = 'db000000-0000-7000-8000-0000000000a1';
const NOTICE = 'd9000000-0000-7000-8000-000000000001';
const CHILD = 'c1000000-0000-7000-8000-000000000031';

describe('applications', () => {
  it('names either one of the parent’s children or a new child, never both or neither', () => {
    expect(
      applicationSchema.safeParse({ intakeId: INTAKE, noticeId: NOTICE, studentId: CHILD }).success,
    ).toBe(true);
    const child = { givenName: 'Nia', familyName: 'Georgieva', birthDate: '2020-05-04' };
    expect(applicationSchema.safeParse({ intakeId: INTAKE, noticeId: NOTICE, child }).success).toBe(true);
    expect(
      applicationSchema.safeParse({ intakeId: INTAKE, noticeId: NOTICE, studentId: CHILD, child }).success,
    ).toBe(false);
    expect(applicationSchema.safeParse({ intakeId: INTAKE, noticeId: NOTICE }).success).toBe(false);
  });

  it('takes no more about a new child than the name and date of birth', () => {
    const child = { givenName: 'Nia', familyName: 'Georgieva', birthDate: '2020-05-04' };
    expect(
      applicationSchema.safeParse({ intakeId: INTAKE, noticeId: NOTICE, child: { ...child, allergies: 'x' } })
        .success,
    ).toBe(false);
    expect(
      applicationSchema.safeParse({
        intakeId: INTAKE,
        noticeId: NOTICE,
        child: { ...child, birthDate: '04.05.2020' },
      }).success,
    ).toBe(false);
    expect(
      applicationSchema.safeParse({ intakeId: INTAKE, noticeId: NOTICE, child, address: 'x' }).success,
    ).toBe(false);
  });

  it('opens intakes with a school year, a grade, places and dates in order', () => {
    const intake = {
      schoolId: 'b1000000-0000-7000-8000-00000000000a',
      schoolYear: '2027/28',
      grade: '1',
      places: 20,
      opensOn: '2026-11-01',
      closesOn: '2027-01-31',
    };
    expect(intakeSchema.safeParse(intake).success).toBe(true);
    expect(intakeSchema.safeParse({ ...intake, schoolYear: '2027-28' }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...intake, places: 0 }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...intake, closesOn: '2026-10-01' }).success).toBe(false);
    expect(inviteSchema.safeParse({ givenName: 'Vera', familyName: '' }).success).toBe(false);
  });
});

describe('offers and decisions', () => {
  it('takes an answer date, known decisions, a yes or no, and staff note kinds', () => {
    expect(offerSchema.safeParse({ answerBy: '2026-11-15' }).success).toBe(true);
    expect(offerSchema.safeParse({ answerBy: 'next week' }).success).toBe(false);
    expect(decisionSchema.safeParse({ decision: 'waitlisted' }).success).toBe(true);
    expect(decisionSchema.safeParse({ decision: 'offered' }).success).toBe(false);
    expect(answerSchema.safeParse({ accept: 'yes' }).success).toBe(false);
    expect(applicationNoteSchema.safeParse({ kind: 'interview', body: 'Calm' }).success).toBe(true);
    expect(applicationNoteSchema.safeParse({ kind: 'gossip', body: 'x' }).success).toBe(false);
  });
});
