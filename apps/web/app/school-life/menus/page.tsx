import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ALLERGEN_CODES, ALLERGENS, MENU_COURSES, type MenuDish } from '@pythagoras/shared';
import { fetchLunchMenus } from '../../../lib/api-client';
import { COURSE_LABELS, DIETARY_DONE, dishLine, MENU_ROWS } from '../../../lib/dietary';
import { formatDay, readRange, shiftRange } from '../../../lib/school-life';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Lunch menus per school and day, with the allergens parents and the kitchen rely on. */
export default async function MenusPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { from, days } = readRange(params);
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchLunchMenus(config.API_INTERNAL_URL, session.accessToken, from, days);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Lunch menus</h1>
        <p data-testid="not-permitted">This page is for School Life and kitchen staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const menus = result.value;
  const done = typeof params.done === 'string' ? (DIETARY_DONE[params.done] ?? null) : null;
  const error = typeof params.error === 'string' ? params.error : null;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/school-life/kitchen">Kitchen</Link> ·{' '}
        <Link href="/school-life/dietary">Dietary needs</Link>
      </p>
      <h1>Lunch menus</h1>
      {done ? (
        <p role="status" data-testid="done">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="error">
          {error}
        </p>
      ) : null}
      <p>
        Tick every allergen a dish contains (EU Regulation 1169/2011, Annex II). Parents see the menu when
        they book, and the kitchen list warns about children whose declared allergens are on their lunch.
      </p>
      <p>
        <Link href={`/school-life/menus${shiftRange(menus.from, menus.days, -1)}`}>Earlier</Link> ·{' '}
        <Link href={`/school-life/menus${shiftRange(menus.from, menus.days, 1)}`}>Later</Link>
      </p>
      {menus.schools.length === 0 ? <p>No lunch is served at your schools in these days.</p> : null}
      {menus.schools.map((entry) => (
        <section
          key={entry.school.id}
          aria-labelledby={`menus-${entry.school.id}`}
          data-testid={`menus-${entry.school.name}`}
        >
          <h2 id={`menus-${entry.school.id}`}>{entry.school.name}</h2>
          {entry.days.map((day) => (
            <article key={day.sessionId} id={`menu-${day.sessionId}`} data-testid={`menu-${day.date}`}>
              <h3>{`${formatDay(day.date)}: ${day.offeringName}`}</h3>
              {day.dishes.length === 0 ? (
                <p data-testid="no-menu">No menu published yet.</p>
              ) : (
                <ul data-testid="dishes">
                  {day.dishes.map((dish, index) => (
                    <li key={index}>{`${COURSE_LABELS[dish.course]}: ${dishLine(dish)}`}</li>
                  ))}
                </ul>
              )}
              {entry.canEdit ? (
                <details>
                  <summary>{day.dishes.length ? 'Change the menu' : 'Publish the menu'}</summary>
                  <MenuForm
                    sessionId={day.sessionId}
                    dishes={day.dishes}
                    from={menus.from}
                    days={menus.days}
                  />
                </details>
              ) : null}
            </article>
          ))}
        </section>
      ))}
    </main>
  );
}

function MenuForm({
  sessionId,
  dishes,
  from,
  days,
}: {
  sessionId: string;
  dishes: MenuDish[];
  from: string;
  days: number;
}) {
  const rows = Array.from({ length: MENU_ROWS }, (_, index) => ({ row: index + 1, dish: dishes[index] }));
  return (
    <form method="post" action="/school-life/menus/actions" data-testid="menu-form">
      <input type="hidden" name="session_id" value={sessionId} />
      <input type="hidden" name="from" value={from} />
      <input type="hidden" name="days" value={days} />
      {rows.map(({ row, dish }) => (
        <fieldset key={row}>
          <legend>{`Dish ${row}`}</legend>
          <label>
            Course{' '}
            <select name={`dish_${row}_course`} defaultValue={dish?.course ?? 'main'}>
              {MENU_COURSES.map((course) => (
                <option key={course} value={course}>
                  {COURSE_LABELS[course]}
                </option>
              ))}
            </select>
          </label>{' '}
          <label>
            Name <input name={`dish_${row}_name`} defaultValue={dish?.name ?? ''} maxLength={200} size={40} />
          </label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.25rem' }}>
            {ALLERGEN_CODES.map((code) => (
              <label key={code}>
                <input
                  type="checkbox"
                  name={`dish_${row}_allergen`}
                  value={code}
                  defaultChecked={dish?.allergens.includes(code)}
                />{' '}
                {ALLERGENS[code]}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <p>Leave a name empty to leave the row out. Saving with every name empty removes the menu.</p>
      <button type="submit" data-testid="save-menu">
        Save the menu
      </button>
    </form>
  );
}
