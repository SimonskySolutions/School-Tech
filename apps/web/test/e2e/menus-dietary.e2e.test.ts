import { readFileSync } from 'node:fs';
import { type LunchMenus } from '@pythagoras/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Lunch menus and dietary needs through the web app (M4.1): the School A
// kitchen publishes a menu with peanuts, and Anna sees it marked for Mila,
// whose peanut allergy is in the seed; Anna records a need for Boris, School
// Life verifies it, and Anna ends it.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const BORIS = 'c1000000-0000-7000-8000-000000000031';
const API = 'http://api:3000';

const decode = (value: string) =>
  value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'").replaceAll('&quot;', '"');

/** The kitchen's API token, to put the seeded menu back afterwards. */
async function kitchenToken(): Promise<string> {
  const response = await fetch('http://keycloak:8080/realms/pythagoras/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'pythagoras-dev-tests',
      username: 'kitchen.a@pythagoras.test',
      password: PASSWORD,
    }),
  });
  return ((await response.json()) as { access_token: string }).access_token;
}

let restore: (() => Promise<void>) | null = null;
afterAll(async () => {
  await restore?.();
});

async function postForm(browser: Browser, path: string, fields: [string, string][], origin = APP) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
}

async function followBack(browser: Browser, response: Response): Promise<string> {
  expect(response.status).toBe(303);
  return (await browser.follow(new URL(response.headers.get('location')!, APP).toString())).response.text();
}

describe('lunch menus', () => {
  it('lets the School A kitchen publish a menu, which Anna sees with a warning for Mila', async () => {
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const page = await (await kitchen.follow(`${APP}/school-life/menus?days=14`)).response.text();
    expect(page).toContain('Lunch menus');
    const days = [
      ...page.matchAll(/data-testid="menu-(\d{4}-\d{2}-\d{2})"[\s\S]*?name="session_id" value="([^"]+)"/g),
    ];
    expect(days.length).toBeGreaterThan(0);
    const [, date, sessionId] = days[days.length - 1]!;

    // Remember the seeded menu of that day to put it back afterwards.
    const token = await kitchenToken();
    const before = (await (
      await fetch(`${API}/school-life/menus?from=${date}&days=1`, {
        headers: { authorization: `Bearer ${token}` },
      })
    ).json()) as LunchMenus;
    const original = before.schools[0]!.days.find((day) => day.sessionId === sessionId)!.dishes;
    restore = async () => {
      await fetch(`${API}/school-life/sessions/${sessionId}/menu`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ dishes: original }),
      });
    };

    const saved = await followBack(
      kitchen,
      await postForm(kitchen, '/school-life/menus/actions', [
        ['session_id', sessionId!],
        ['from', date!],
        ['days', '1'],
        ['dish_1_course', 'main'],
        ['dish_1_name', 'Satay chicken (e2e)'],
        ['dish_1_allergen', 'peanuts'],
        ['dish_1_allergen', 'soybeans'],
        ['dish_2_course', 'dessert'],
        ['dish_2_name', 'Fruit salad (e2e)'],
      ]),
    );
    expect(saved).toContain('Menu saved.');
    expect(decode(saved)).toContain('Satay chicken (e2e) (contains peanuts, soybeans)');

    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const services = decode(await (await anna.follow(`${APP}/services`)).response.text());
    const milaStart = services.indexOf('data-testid="child-Mila"');
    const milaPart = services.slice(milaStart, services.indexOf('</section>', milaStart));
    const day = milaPart.slice(milaPart.indexOf(`data-testid="lunch-day-${date}"`));
    expect(day).toContain('Satay chicken (e2e) (contains peanuts, soybeans)');
    expect(day.slice(0, day.indexOf('</li>'))).toContain(
      'Contains peanuts, declared for Mila: Satay chicken (e2e).',
    );
    expect(milaPart).toContain('Dietary needs (allergens: peanuts)');
  });

  it('shows the kitchen each day’s menu next to the counts', async () => {
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const page = decode(await (await kitchen.follow(`${APP}/school-life/kitchen?days=7`)).response.text());
    expect(page).toContain('<th style="text-align:left;padding-right:1rem">Menu</th>');
    expect(page).toMatch(/data-testid="menu"[^>]*><ul/);
  });

  it('refuses menu forms from another site and from staff who may not publish', async () => {
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      kitchen,
      '/school-life/menus/actions',
      [['session_id', MILA]],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    const page = await (await teacher.follow(`${APP}/school-life/menus?days=3`)).response.text();
    expect(page).not.toContain('name="session_id"');
  });
});

describe('dietary needs', () => {
  it("shows Anna Mila's peanut allergy and keeps other parents out", async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const page = await (await anna.follow(`${APP}/children/${MILA}/dietary`)).response.text();
    expect(page).toContain('Dietary needs: Mila Ivanova');
    expect(page).toContain('Peanuts (synthetic example)');
    expect(page).toContain('Allergens: Peanuts');
    const hristo = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    const refused = await (await hristo.follow(`${APP}/children/${MILA}/dietary`)).response.text();
    expect(refused).toContain('data-testid="not-permitted"');
    expect(refused).not.toContain('Peanuts');
  });

  it('lets Anna record a need for Boris, School Life verify it, and Anna end it', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const added = await followBack(
      anna,
      await postForm(anna, `/children/${BORIS}/dietary/actions`, [
        ['action', 'add'],
        ['kind', 'allergy'],
        ['description', 'Mustard (e2e test)'],
        ['severity', 'moderate'],
        ['allergen', 'mustard'],
      ]),
    );
    expect(added).toContain('Saved. School Life will check it');
    const need =
      /data-testid="need-([0-9a-f-]{36})"(?:(?!data-testid="need-)[\s\S])*?Mustard \(e2e test\)/.exec(added);
    expect(need).not.toBeNull();
    const needId = need![1]!;
    const own = added.slice(added.indexOf(`data-testid="need-${needId}"`));
    expect(own).toContain('Not yet verified by School Life');
    expect(own).toContain('Remove (recorded by mistake)');

    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    const review = await (await schoolLife.follow(`${APP}/school-life/dietary`)).response.text();
    const row = review.slice(review.indexOf(`data-testid="need-${needId}"`));
    expect(row).toContain('Boris Ivanov');
    expect(row.slice(0, row.indexOf('</tr>'))).toContain('data-testid="verify"');
    const verified = await followBack(
      schoolLife,
      await postForm(schoolLife, '/school-life/dietary/actions', [['need_id', needId]]),
    );
    expect(verified).toContain('Verified.');

    const after = await (await anna.follow(`${APP}/children/${BORIS}/dietary`)).response.text();
    const mine = after.slice(after.indexOf(`data-testid="need-${needId}"`));
    expect(mine).toContain('Verified by School Life');
    expect(mine).toContain('No longer needed from tomorrow');

    const ended = await followBack(
      anna,
      await postForm(anna, `/children/${BORIS}/dietary/actions`, [
        ['action', 'end'],
        ['need_id', needId],
      ]),
    );
    expect(ended).toContain('Ended. It still applies today');
    expect(ended.slice(ended.indexOf(`data-testid="need-${needId}"`))).toContain('Applies until');
  });

  it('refuses dietary forms from another site and keeps the review from the kitchen', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      anna,
      `/children/${BORIS}/dietary/actions`,
      [['action', 'add']],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const review = await (await kitchen.follow(`${APP}/school-life/dietary`)).response.text();
    expect(review).toContain('data-testid="not-permitted"');
  });
});
