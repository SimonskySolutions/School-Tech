import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { allergenNames, dishLine, menuBody, menuWarnings, type MultiForm, needBody } from './dietary';

const form = (fields: [string, string][]): MultiForm => {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
};

describe('menus', () => {
  it('reads the dish rows, leaving out rows without a name and unknown allergens', () => {
    expect(
      menuBody(
        form([
          ['dish_1_course', 'soup'],
          ['dish_1_name', ' Tarator '],
          ['dish_1_allergen', 'milk'],
          ['dish_1_allergen', 'nuts'],
          ['dish_1_allergen', 'milk'],
          ['dish_1_allergen', 'kiwi'],
          ['dish_2_course', 'main'],
          ['dish_2_name', ''],
          ['dish_3_course', 'dessert'],
          ['dish_3_name', 'Fruit'],
        ]),
      ),
    ).toEqual({
      dishes: [
        { course: 'soup', name: 'Tarator', allergens: ['milk', 'nuts'] },
        { course: 'dessert', name: 'Fruit', allergens: [] },
      ],
    });
    expect(menuBody(form([]))).toEqual({ dishes: [] });
    expect(() =>
      menuBody(
        form([
          ['dish_1_name', 'Soup'],
          ['dish_1_course', 'snack'],
        ]),
      ),
    ).toThrow(FormProblem);
  });

  it('shows allergens by their names, in the order of the regulation', () => {
    expect(allergenNames(['milk', 'gluten', 'peanuts'])).toBe('Cereals containing gluten, Peanuts, Milk');
    expect(dishLine({ course: 'main', name: 'Moussaka', allergens: ['milk', 'eggs'] })).toBe(
      'Moussaka (contains eggs, milk)',
    );
    expect(dishLine({ course: 'dessert', name: 'Apple', allergens: [] })).toBe('Apple');
  });

  it("points out the dishes that contain one of the child's allergens", () => {
    const menu = [
      { course: 'main' as const, name: 'Noodles', allergens: ['gluten' as const, 'peanuts' as const] },
      { course: 'dessert' as const, name: 'Apple', allergens: [] },
    ];
    expect(menuWarnings(menu, ['peanuts', 'sesame'])).toEqual([{ dish: 'Noodles', allergens: ['peanuts'] }]);
    expect(menuWarnings(menu, [])).toEqual([]);
  });
});

describe('dietary needs', () => {
  it('reads a need with its allergens; severity is optional', () => {
    expect(
      needBody(
        form([
          ['kind', 'allergy'],
          ['description', ' Sesame: hives '],
          ['severity', 'severe'],
          ['allergen', 'sesame'],
        ]),
      ),
    ).toEqual({ kind: 'allergy', description: 'Sesame: hives', severity: 'severe', allergens: ['sesame'] });
    expect(
      needBody(
        form([
          ['kind', 'vegetarian'],
          ['description', 'No meat'],
          ['severity', ''],
        ]),
      ),
    ).toEqual({
      kind: 'vegetarian',
      description: 'No meat',
      severity: null,
      allergens: [],
    });
  });

  it('refuses a need without a known kind, a description or a known severity', () => {
    expect(() =>
      needBody(
        form([
          ['kind', 'diet'],
          ['description', 'x'],
        ]),
      ),
    ).toThrow(FormProblem);
    expect(() =>
      needBody(
        form([
          ['kind', 'allergy'],
          ['description', ' '],
        ]),
      ),
    ).toThrow(FormProblem);
    expect(() =>
      needBody(
        form([
          ['kind', 'allergy'],
          ['description', 'x'],
          ['severity', 'deadly'],
        ]),
      ),
    ).toThrow(FormProblem);
  });
});
