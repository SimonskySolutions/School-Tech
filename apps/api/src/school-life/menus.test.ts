import { describe, expect, it } from 'vitest';
import { needSchema } from '../dietary/dietary.controller';
import { menuBody } from './school-life.controller';
import { menuConflicts } from './menus';
import { byDanger } from './school-life.repository';

const menu = [
  { course: 'soup' as const, name: 'Tarator', allergens: ['milk' as const, 'nuts' as const] },
  { course: 'main' as const, name: 'Rice', allergens: [] },
  {
    course: 'dessert' as const,
    name: 'Peanut cookie',
    allergens: ['peanuts' as const, 'gluten' as const, 'milk' as const],
  },
];

describe('lunch menus and allergens', () => {
  it('finds every dish on the menu that contains one of the child’s allergens', () => {
    expect(menuConflicts(menu, ['peanuts'])).toEqual([{ dish: 'Peanut cookie', allergens: ['peanuts'] }]);
    expect(menuConflicts(menu, ['milk', 'sesame'])).toEqual([
      { dish: 'Tarator', allergens: ['milk'] },
      { dish: 'Peanut cookie', allergens: ['milk'] },
    ]);
    expect(menuConflicts(menu, [])).toEqual([]);
    expect(menuConflicts([], ['peanuts'])).toEqual([]);
  });

  it('puts a child whose allergen is on the menu first, then the most severe', () => {
    const needs = [
      { name: 'moderate, on menu', severity: 'moderate', menuConflicts: [{}] },
      { name: 'life-threatening', severity: 'life_threatening', menuConflicts: [] },
      { name: 'unknown', severity: null, menuConflicts: [] },
      { name: 'severe, on menu', severity: 'severe', menuConflicts: [{}] },
    ];
    expect([...needs].sort(byDanger).map((need) => need.name)).toEqual([
      'severe, on menu',
      'moderate, on menu',
      'life-threatening',
      'unknown',
    ]);
  });

  it('accepts only known courses and allergen codes, at most 12 dishes, without duplicates', () => {
    const dish = { course: 'main', name: ' Moussaka ', allergens: ['eggs', 'milk', 'eggs'] };
    expect(menuBody.parse({ dishes: [dish] }).dishes[0]).toEqual({
      course: 'main',
      name: 'Moussaka',
      allergens: ['eggs', 'milk'],
    });
    expect(menuBody.safeParse({ dishes: [{ ...dish, allergens: ['kiwi'] }] }).success).toBe(false);
    expect(menuBody.safeParse({ dishes: [{ ...dish, course: 'snack' }] }).success).toBe(false);
    expect(menuBody.safeParse({ dishes: [{ ...dish, name: '  ' }] }).success).toBe(false);
    expect(menuBody.safeParse({ dishes: Array.from({ length: 13 }, () => dish) }).success).toBe(false);
    expect(menuBody.parse({ dishes: [] }).dishes).toEqual([]);
  });

  it('accepts a dietary need with a known kind, severity and allergens', () => {
    expect(
      needSchema.parse({ kind: 'allergy', description: 'Sesame', severity: 'severe', allergens: ['sesame'] }),
    ).toEqual({ kind: 'allergy', description: 'Sesame', severity: 'severe', allergens: ['sesame'] });
    expect(needSchema.safeParse({ kind: 'allergy', description: '', allergens: [] }).success).toBe(false);
    expect(needSchema.safeParse({ kind: 'diet', description: 'x', allergens: [] }).success).toBe(false);
    expect(
      needSchema.safeParse({ kind: 'allergy', description: 'x', severity: 'deadly', allergens: [] }).success,
    ).toBe(false);
    expect(needSchema.safeParse({ kind: 'allergy', description: 'x', allergens: ['kiwi'] }).success).toBe(
      false,
    );
  });
});
