import { describe, expect, it } from 'vitest';
import { bySeverity } from './school-life.repository';

describe('dietary needs order', () => {
  it('puts the most dangerous needs first and unknown severities last', () => {
    const needs = ['information', null, 'life_threatening', 'moderate', 'severe'].map((severity) => ({
      severity,
    }));
    expect(needs.sort(bySeverity).map((need) => need.severity)).toEqual([
      'life_threatening',
      'severe',
      'moderate',
      'information',
      null,
    ]);
  });
});
