import { type EligibilityRules } from '@pythagoras/shared';
import { z } from 'zod';

// Who may take an offering (M4.2). The API speaks camelCase; the database
// stores {"grades", "min_age", "max_age"} and checks the shape itself
// (catalog.is_valid_eligibility) and every booking against it.

export const eligibilitySchema: z.ZodType<EligibilityRules> = z
  .object({
    grades: z
      .array(z.string().trim().min(1).max(40))
      .min(1)
      .max(20)
      .transform((grades) => [...new Set(grades)])
      .optional(),
    minAge: z.number().int().min(0).max(25).optional(),
    maxAge: z.number().int().min(0).max(25).optional(),
  })
  .strict()
  .refine(
    (rules) => rules.minAge === undefined || rules.maxAge === undefined || rules.minAge <= rules.maxAge,
    {
      message: 'the minimum age is above the maximum',
    },
  );

export function eligibilityToDatabase(rules: EligibilityRules): Record<string, unknown> {
  return {
    ...(rules.grades?.length ? { grades: rules.grades } : {}),
    ...(rules.minAge !== undefined ? { min_age: rules.minAge } : {}),
    ...(rules.maxAge !== undefined ? { max_age: rules.maxAge } : {}),
  };
}

export function eligibilityFromDatabase(stored: Record<string, unknown>): EligibilityRules {
  const rules: EligibilityRules = {};
  if (Array.isArray(stored.grades))
    rules.grades = stored.grades.filter((g): g is string => typeof g === 'string');
  if (typeof stored.min_age === 'number') rules.minAge = stored.min_age;
  if (typeof stored.max_age === 'number') rules.maxAge = stored.max_age;
  return rules;
}
