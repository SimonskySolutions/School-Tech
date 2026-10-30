import { describe, expect, it } from 'vitest';
import { isoWeekday, missingForActivation, schoolDays, weeklyDays } from './calendar';

describe('school calendars', () => {
  it('knows the weekday of a calendar date', () => {
    expect(isoWeekday('2026-11-02')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
  });

  it('lists Monday to Friday without closed days, across a month end', () => {
    expect(schoolDays('2026-10-29', '2026-11-04', ['2026-11-02'])).toEqual([
      '2026-10-29',
      '2026-10-30',
      '2026-11-03',
      '2026-11-04',
    ]);
  });

  it('lists one weekday a week', () => {
    expect(weeklyDays('2026-11-01', '2026-11-30', 3, ['2026-11-18'])).toEqual([
      '2026-11-04',
      '2026-11-11',
      '2026-11-25',
    ]);
  });

  it('refuses impossible dates, reversed or over-long ranges and bad weekdays', () => {
    expect(() => schoolDays('2026-02-30', '2026-03-02')).toThrow('not a date');
    expect(() => schoolDays('2026-11-05', '2026-11-01')).toThrow('after the last');
    expect(() => schoolDays('2026-01-01', '2027-03-01')).toThrow('at most 400 days');
    expect(() => weeklyDays('2026-11-01', '2026-11-30', 8)).toThrow('weekday');
    expect(() => schoolDays('2026-11-01', '2026-11-30', ['soon'])).toThrow('not a date');
  });
});

describe('missingForActivation', () => {
  it('is empty for a draft school with priced offerings, sessions and a principal', () => {
    expect(
      missingForActivation({
        status: 'draft',
        publishedOfferings: 2,
        offeringsWithoutSessions: [],
        principals: 1,
      }),
    ).toEqual([]);
  });

  it('lists everything that is still missing', () => {
    expect(
      missingForActivation({
        status: 'draft',
        publishedOfferings: 1,
        offeringsWithoutSessions: ['Lunch at School D'],
        principals: 0,
      }),
    ).toEqual(['sessions for Lunch at School D', 'a principal']);
    expect(
      missingForActivation({
        status: 'active',
        publishedOfferings: 0,
        offeringsWithoutSessions: [],
        principals: 1,
      }),
    ).toEqual(['the school is already active', 'at least one published offering with a price']);
  });
});
