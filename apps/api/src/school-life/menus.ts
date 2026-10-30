import { type Allergen, type LunchMenus, type MenuDish, type SchoolId } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';
import { type DateRange } from './school-life.repository';

// Lunch menus (M4.1): the dishes of one lunch session (an offering on one day)
// with their declared allergens. School Life, principals and the school's
// kitchen publish them (menus.manage); whoever may see the lunch day reads them.

interface DishRow {
  session_id: string;
  course: MenuDish['course'];
  name: string;
  allergens: Allergen[];
}

/** The dishes of these sessions, in menu order, keyed by session. */
export async function dishesBySession(
  tx: PersonTransaction,
  sessionIds: readonly string[],
): Promise<Map<string, MenuDish[]>> {
  const rows = sessionIds.length
    ? await tx.query<DishRow>(
        `SELECT session_id, course, name, allergens FROM scheduling.menu_dish
          WHERE session_id = ANY ($1::uuid[]) ORDER BY session_id, position`,
        [sessionIds],
      )
    : [];
  const menus = new Map<string, MenuDish[]>();
  for (const row of rows) {
    const dishes = menus.get(row.session_id) ?? [];
    dishes.push({ course: row.course, name: row.name, allergens: row.allergens });
    menus.set(row.session_id, dishes);
  }
  return menus;
}

/** Dishes that contain one of the child's declared allergens. */
export function menuConflicts(
  dishes: readonly MenuDish[],
  allergens: readonly Allergen[],
): { dish: string; allergens: Allergen[] }[] {
  if (allergens.length === 0) return [];
  return dishes.flatMap((dish) => {
    const found = dish.allergens.filter((allergen) => allergens.includes(allergen));
    return found.length ? [{ dish: dish.name, allergens: found }] : [];
  });
}

interface MenuSessionRow {
  id: string;
  school_id: SchoolId;
  school_name: string;
  service_date: string;
  offering_name: string;
  can_edit: boolean;
}

export async function lunchMenus(tx: PersonTransaction, range: DateRange): Promise<LunchMenus> {
  const sessions = await tx.query<MenuSessionRow>(
    `SELECT s.id, s.school_id, sc.name AS school_name, to_char(s.service_date, 'YYYY-MM-DD') AS service_date,
            o.name AS offering_name, access.has_permission('menus.manage', s.school_id) AS can_edit
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       JOIN org.school sc ON sc.id = s.school_id
      WHERE d.kind = 'lunch' AND s.status <> 'cancelled'
        AND (access.has_permission('menus.manage', s.school_id) OR access.has_permission('bookings.read', s.school_id))
        AND s.service_date BETWEEN $1::date AND $1::date + ($2::int - 1)
      ORDER BY sc.name, s.service_date, o.name`,
    [range.from, range.days],
  );
  const menus = await dishesBySession(
    tx,
    sessions.map((session) => session.id),
  );
  const schools = new Map<string, LunchMenus['schools'][number]>();
  for (const session of sessions) {
    const school = schools.get(session.school_id) ?? {
      school: { id: session.school_id, name: session.school_name },
      canEdit: session.can_edit,
      days: [],
    };
    school.days.push({
      date: session.service_date,
      sessionId: session.id,
      offeringName: session.offering_name,
      dishes: menus.get(session.id) ?? [],
    });
    schools.set(session.school_id, school);
  }
  return { ...range, schools: [...schools.values()] };
}

export class MenuRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 422,
    message: string,
  ) {
    super(message);
  }
}

/** Replaces the menu of one lunch session; an empty list removes it. */
export async function setMenu(
  tx: PersonTransaction,
  sessionId: string,
  dishes: readonly MenuDish[],
): Promise<MenuDish[]> {
  const [session] = await tx.query<{ group_id: string; school_id: string; kind: string; may: boolean }>(
    `SELECT s.group_id, s.school_id, d.kind, access.has_permission('menus.manage', s.school_id) AS may
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
      WHERE s.id = $1`,
    [sessionId],
  );
  if (!session) throw new MenuRejected(404, 'no such lunch day, or not yours to see');
  if (!session.may) throw new MenuRejected(403, 'you may not publish menus at this school');
  if (session.kind !== 'lunch') throw new MenuRejected(422, 'menus are for lunch days only');

  await tx.query('DELETE FROM scheduling.menu_dish WHERE session_id = $1', [sessionId]);
  if (dishes.length) {
    await tx.query(
      `INSERT INTO scheduling.menu_dish (group_id, school_id, session_id, position, course, name, allergens)
       SELECT $1, $2, $3, d.position, d.course, d.name, ARRAY(SELECT jsonb_array_elements_text(d.allergens))
         FROM jsonb_to_recordset($4::jsonb) AS d (position int, course text, name text, allergens jsonb)`,
      [
        session.group_id,
        session.school_id,
        sessionId,
        JSON.stringify(dishes.map((dish, index) => ({ ...dish, position: index + 1 }))),
      ],
    );
  }
  return [...dishes];
}
