import { type EligibilityRules } from './api.js';

/** "Grades 2, 3 · ages 7–11", or null when anyone may take it. */
export function describeEligibility(rules: EligibilityRules): string | null {
  const parts: string[] = [];
  if (rules.grades?.length) parts.push(`grades ${rules.grades.join(', ')}`);
  if (rules.minAge !== undefined || rules.maxAge !== undefined) {
    parts.push(`ages ${rules.minAge ?? 0}–${rules.maxAge ?? 'any'}`);
  }
  return parts.length ? parts.join(' · ') : null;
}
