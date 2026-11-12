import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { academicYearOf, enrolBody, guardianBody } from './families';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('enrolling a student', () => {
  it('sends only the details given', () => {
    expect(
      enrolBody(
        form({
          given_name: 'Daria',
          family_name: 'Ivanova',
          academic_year: '2026/2027',
          class_label: '1D',
          start_date: '2026-09-15',
        }),
      ),
    ).toEqual({
      givenName: 'Daria',
      familyName: 'Ivanova',
      academicYear: '2026/2027',
      classLabel: '1D',
      startDate: '2026-09-15',
    });
  });

  it('refuses a date of birth that is not a date', () => {
    expect(() => enrolBody(form({ date_of_birth: '15.09.2020' }))).toThrow(FormProblem);
  });

  it('knows the school year of a date', () => {
    expect(academicYearOf(new Date('2026-10-30T00:00:00Z'))).toBe('2026/2027');
    expect(academicYearOf(new Date('2027-03-01T00:00:00Z'))).toBe('2026/2027');
    expect(academicYearOf(new Date('2027-09-01T00:00:00Z'))).toBe('2027/2028');
  });
});

describe('recording a guardian', () => {
  it('reads what the guardian may do from the checkboxes', () => {
    expect(
      guardianBody(
        form({
          email: 'Anna.Ivanova@Pythagoras.test',
          relationship: 'mother',
          can_pay: 'on',
          can_manage_bookings: 'on',
        }),
      ),
    ).toEqual({
      email: 'anna.ivanova@pythagoras.test',
      relationship: 'mother',
      canPay: true,
      canManageBookings: true,
      canConsent: false,
    });
  });

  it('passes names on for someone new', () => {
    expect(
      guardianBody(form({ email: 'x@y.test', given_name: 'Ivan', family_name: 'Ivanov' })),
    ).toMatchObject({
      givenName: 'Ivan',
      familyName: 'Ivanov',
      relationship: 'parent',
    });
  });
});
