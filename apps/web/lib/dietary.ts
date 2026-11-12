import {
  ALLERGEN_CODES,
  ALLERGENS,
  type Allergen,
  DIETARY_KINDS,
  DIETARY_SEVERITIES,
  type DietaryNeedRequest,
  MENU_COURSES,
  type MenuDish,
} from '@pythagoras/shared';
import { type Form, FormProblem, text } from './admin';

// Menus and dietary needs in the web app (M4.1): form reading and display
// rules as plain functions, tested without a browser. The API and the
// database check everything again.

/** A form that may send one field several times (allergen checkboxes). */
export type MultiForm = Form & { getAll(name: string): FormDataEntryValue[] };

export const COURSE_LABELS: Record<MenuDish['course'], string> = {
  starter: 'Starter',
  soup: 'Soup',
  main: 'Main course',
  side: 'Side',
  dessert: 'Dessert',
  drink: 'Drink',
  other: 'Other',
};

/** Up to this many dish rows on the menu form. */
export const MENU_ROWS = 6;

const allergensOf = (form: MultiForm, name: string): Allergen[] => [
  ...new Set(
    form
      .getAll(name)
      .filter((value): value is string => typeof value === 'string')
      .filter((value): value is Allergen => (ALLERGEN_CODES as string[]).includes(value)),
  ),
];

/** "Peanuts, Milk" in the order of the regulation's list. */
export function allergenNames(codes: readonly Allergen[]): string {
  return ALLERGEN_CODES.filter((code) => codes.includes(code))
    .map((code) => ALLERGENS[code])
    .join(', ');
}

/** One dish as a line: "Moussaka (contains eggs, milk, cereals containing gluten)". */
export function dishLine(dish: MenuDish): string {
  const contains = allergenNames(dish.allergens);
  return contains ? `${dish.name} (contains ${contains.toLowerCase()})` : dish.name;
}

/** Dishes containing one of the child's declared allergens, with which ones. */
export function menuWarnings(
  menu: readonly MenuDish[],
  allergens: readonly Allergen[],
): { dish: string; allergens: Allergen[] }[] {
  return menu.flatMap((dish) => {
    const found = dish.allergens.filter((allergen) => allergens.includes(allergen));
    return found.length ? [{ dish: dish.name, allergens: found }] : [];
  });
}

/** The dish rows of the menu form; rows without a name are left out. */
export function menuBody(form: MultiForm): { dishes: MenuDish[] } {
  const dishes: MenuDish[] = [];
  for (let row = 1; row <= MENU_ROWS; row += 1) {
    const name = text(form, `dish_${row}_name`);
    if (!name) continue;
    const course = text(form, `dish_${row}_course`);
    if (!(MENU_COURSES as readonly string[]).includes(course)) {
      throw new FormProblem(`choose a course for "${name}"`);
    }
    if (name.length > 200) throw new FormProblem('a dish name has at most 200 characters');
    dishes.push({
      course: course as MenuDish['course'],
      name,
      allergens: allergensOf(form, `dish_${row}_allergen`),
    });
  }
  return { dishes };
}

/** A dietary need from the parent's or School Life's form. */
export function needBody(form: MultiForm): DietaryNeedRequest {
  const kind = text(form, 'kind');
  if (!(DIETARY_KINDS as readonly string[]).includes(kind))
    throw new FormProblem('choose what kind of need it is');
  const description = text(form, 'description');
  if (!description) throw new FormProblem('describe the need, for example what happens and what to avoid');
  if (description.length > 500) throw new FormProblem('the description has at most 500 characters');
  const severity = text(form, 'severity');
  if (severity && !(DIETARY_SEVERITIES as readonly string[]).includes(severity)) {
    throw new FormProblem('choose how serious it is');
  }
  return {
    kind: kind as DietaryNeedRequest['kind'],
    description,
    severity: (severity || null) as DietaryNeedRequest['severity'],
    allergens: allergensOf(form, 'allergen'),
  };
}

export const DIETARY_DONE: Record<string, string> = {
  added: 'Saved. School Life will check it; until then the kitchen sees it marked "not yet verified".',
  changed: 'Changed. School Life will check the change.',
  ended: 'Ended. It still applies today and no longer from tomorrow.',
  withdrawn: 'Removed.',
  verified: 'Verified.',
  menu: 'Menu saved.',
};
