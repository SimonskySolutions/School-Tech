import { describe, expect, it } from 'vitest';
import {
  cancelNotice,
  dietaryLabel,
  formatDay,
  formatSessionTime,
  isUrgent,
  readLunchQuery,
  readRange,
  shiftRange,
} from './school-life';

describe('readRange', () => {
  it('accepts a date and a day count, and drops anything else', () => {
    expect(readRange({ from: '2026-11-02', days: '7' })).toEqual({ from: '2026-11-02', days: 7 });
    expect(readRange({ from: '02.11.2026', days: '40' })).toEqual({ from: null, days: null });
    expect(readRange({ from: ['2026-11-02'], days: '0' })).toEqual({ from: null, days: null });
    expect(readRange({})).toEqual({ from: null, days: null });
  });

  it('moves a range by its own length, across months', () => {
    expect(shiftRange('2026-10-29', 5, 1)).toBe('?from=2026-11-03&days=5');
    expect(shiftRange('2026-11-02', 5, -1)).toBe('?from=2026-10-28&days=5');
  });
});

describe('dates and times', () => {
  it('shows a calendar day without shifting it', () => {
    expect(formatDay('2026-11-02')).toBe('Monday 2 November');
  });

  it("shows a session in the school's time zone", () => {
    // 12:00 UTC is 14:00 in Sofia in November (UTC+2).
    expect(formatSessionTime('2026-11-04T12:00:00Z', '2026-11-04T13:00:00Z', 'Europe/Sofia')).toBe(
      'Wed 4 Nov, 14:00–15:00',
    );
    expect(formatSessionTime('2026-11-04T12:00:00Z', null, 'UTC')).toBe('Wed 4 Nov, 12:00');
  });
});

describe('dietary needs', () => {
  it('names the need and its severity, and flags the dangerous ones', () => {
    expect(dietaryLabel('allergy', 'life_threatening')).toBe('Allergy (Life-threatening)');
    expect(dietaryLabel('vegetarian', null)).toBe('Vegetarian');
    expect(isUrgent('life_threatening')).toBe(true);
    expect(isUrgent('severe')).toBe(true);
    expect(isUrgent('moderate')).toBe(false);
  });
});

describe('lunch list and cancellation', () => {
  it('needs both a school id and a date', () => {
    const school = 'b1000000-0000-7000-8000-00000000000a';
    expect(readLunchQuery({ schoolId: school, date: '2026-11-02' })).toEqual({
      schoolId: school,
      date: '2026-11-02',
    });
    expect(readLunchQuery({ schoolId: 'school-a', date: '2026-11-02' })).toBeNull();
    expect(readLunchQuery({ schoolId: school })).toBeNull();
  });

  it('explains what happened to a cancellation', () => {
    expect(cancelNotice(400)).toBe('no-reason');
    expect(cancelNotice(409)).toBe('refused');
    expect(cancelNotice(403)).toBe('refused');
    expect(cancelNotice(500)).toBe('failed');
  });
});
