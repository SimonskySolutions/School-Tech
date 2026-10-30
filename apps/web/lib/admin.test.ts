import { describe, expect, it } from 'vitest';
import {
  amountMinor,
  backTo,
  dateList,
  FormProblem,
  offeringBody,
  schoolBody,
  sessionsBody,
  staffBody,
} from './admin';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('amounts and dates typed by an administrator', () => {
  it('reads euros with a dot or a comma into cents', () => {
    expect(amountMinor('5.20')).toBe(520);
    expect(amountMinor('5,2')).toBe(520);
    expect(amountMinor('60')).toBe(6000);
  });

  it('refuses what is not an amount', () => {
    expect(() => amountMinor('5.205')).toThrow(FormProblem);
    expect(() => amountMinor('-1')).toThrow('not an amount');
    expect(() => amountMinor('')).toThrow(FormProblem);
  });

  it('reads closed days one per line or separated by commas', () => {
    expect(dateList('2026-11-02\n2026-11-03, 2026-12-24')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-12-24',
    ]);
    expect(dateList('  ')).toEqual([]);
    expect(() => dateList('24.12.2026')).toThrow('not a date');
  });
});

describe('forms into API requests', () => {
  it('builds a school with defaults for kind and time zone', () => {
    expect(schoolBody(form({ code: ' School-D ', name: 'School D', billing_entity_id: 'e1' }))).toEqual({
      code: 'school-d',
      name: 'School D',
      kind: 'school',
      timeZone: 'Europe/Sofia',
      billingEntityId: 'e1',
    });
  });

  it('builds an offering with its price in cents', () => {
    expect(
      offeringBody(
        form({
          service_definition_id: 's1',
          name: 'Lunch at School D',
          price: '5,20',
          price_unit: 'per_day',
        }),
      ),
    ).toEqual({
      serviceDefinitionId: 's1',
      name: 'Lunch at School D',
      unitAmountMinor: 520,
      priceUnit: 'per_day',
    });
  });

  it('builds a school-day calendar with closures, and a weekly one', () => {
    expect(
      sessionsBody(
        form({
          offering_id: 'o1',
          capacity: '80',
          pattern: 'school_days',
          from: '2026-11-02',
          to: '2026-11-13',
          closed: '2026-11-04',
        }),
      ),
    ).toEqual({
      offeringId: 'o1',
      capacity: 80,
      location: undefined,
      schedule: { type: 'school_days', from: '2026-11-02', to: '2026-11-13', closed: ['2026-11-04'] },
    });
    expect(
      sessionsBody(
        form({
          offering_id: 'o2',
          capacity: '12',
          location: 'Room 3',
          pattern: 'weekly',
          weekday: '3',
          start_time: '14:00',
          end_time: '15:00',
          from: '2026-11-02',
          to: '2026-12-18',
        }),
      ).schedule,
    ).toEqual({
      type: 'weekly',
      weekday: 3,
      startTime: '14:00',
      endTime: '15:00',
      from: '2026-11-02',
      to: '2026-12-18',
    });
  });

  it('lower-cases a staff e-mail address', () => {
    expect(
      staffBody(
        form({ given_name: 'Tanya', family_name: 'P', email: 'Tanya@School.test', role_code: 'principal' }),
      ).email,
    ).toBe('tanya@school.test');
  });
});

describe('backTo', () => {
  it('returns to a set-up page with a notice', () => {
    const id = '01900000-0000-7000-8000-000000000001';
    expect(backTo(`/admin/schools/${id}`, { done: 'activate' })).toBe(`/admin/schools/${id}?done=activate`);
  });

  it('never sends the administrator anywhere else', () => {
    expect(backTo('https://evil.test/', { error: 'x' })).toBe('/admin/schools?error=x');
    expect(backTo('/admin/schools/../../me', {})).toBe('/admin/schools?');
  });
});
