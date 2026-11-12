import { describe, expect, it } from 'vitest';
import { describeEligibility } from '@pythagoras/shared';
import { eligibilityFromDatabase, eligibilitySchema, eligibilityToDatabase } from './eligibility';

describe('eligibility rules', () => {
  it('accepts grades and whole-year ages, without duplicates', () => {
    expect(eligibilitySchema.parse({ grades: [' 3', '4', '3'], minAge: 7, maxAge: 11 })).toEqual({
      grades: ['3', '4'],
      minAge: 7,
      maxAge: 11,
    });
    expect(eligibilitySchema.parse({})).toEqual({});
  });

  it('refuses unknown rules, empty grades, ages out of range and a minimum above the maximum', () => {
    expect(eligibilitySchema.safeParse({ grade: ['3'] }).success).toBe(false);
    expect(eligibilitySchema.safeParse({ grades: [] }).success).toBe(false);
    expect(eligibilitySchema.safeParse({ minAge: 7.5 }).success).toBe(false);
    expect(eligibilitySchema.safeParse({ maxAge: 30 }).success).toBe(false);
    expect(eligibilitySchema.safeParse({ minAge: 9, maxAge: 7 }).success).toBe(false);
  });

  it('stores the rules in the database shape and reads them back', () => {
    const rules = { grades: ['5', '6'], minAge: 10 };
    expect(eligibilityToDatabase(rules)).toEqual({ grades: ['5', '6'], min_age: 10 });
    expect(eligibilityFromDatabase(eligibilityToDatabase(rules))).toEqual(rules);
    expect(eligibilityToDatabase({})).toEqual({});
    expect(eligibilityFromDatabase({ grades: 'x', min_age: '7' })).toEqual({});
  });

  it('describes the rules for people', () => {
    expect(describeEligibility({ grades: ['2', '3'], minAge: 7, maxAge: 11 })).toBe(
      'grades 2, 3 · ages 7–11',
    );
    expect(describeEligibility({ minAge: 5 })).toBe('ages 5–any');
    expect(describeEligibility({})).toBeNull();
  });
});
