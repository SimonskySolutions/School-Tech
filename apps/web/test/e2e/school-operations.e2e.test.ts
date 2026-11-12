import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Running a school: a class with a limit and a timetable, the register and
// grades, stock, money, and all schools on one screen. Rows this test adds are
// removed by db/seeds/reset-test-data.sql, so it expects the plain development seed.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_B = 'b1000000-0000-7000-8000-00000000000b';
const SCHOOL_C = 'b1000000-0000-7000-8000-00000000000c';
const MILA = 'c1000000-0000-7000-8000-000000000030';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");

const page = async (browser: Browser, path: string) => {
  const { response, url } = await browser.follow(`${APP}${path}`);
  expect(response.status, path).toBe(200);
  return { url, html: decode(await response.text()) };
};

async function post(browser: Browser, path: string, fields: [string, string][]): Promise<string> {
  const response = await browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
  expect(response.status, path).toBe(303);
  const back = await browser.follow(new URL(response.headers.get('location')!, APP).toString());
  return decode(await back.response.text());
}

/** The value of the option showing some text, in a select named `name`. */
function option(html: string, name: string, shown: string): string {
  const select = new RegExp(`<select[^>]*name="${name}"[^>]*>(.*?)</select>`, 's').exec(html)?.[1];
  expect(select, name).toBeTruthy();
  const found = new RegExp(`<option[^>]*value="(${UUID})"[^>]*>[^<]*${shown}`).exec(select!);
  expect(found, `${name}: ${shown}`).toBeTruthy();
  return found![1]!;
}

const signedIn = async (who: string) => (await signIn(`${who}@pythagoras.test`, PASSWORD)).browser;

describe('running a school', () => {
  it('plans a class and its week, takes the register, and shows the family', async () => {
    const principal = await signedIn('principal.a');
    const classes = `/schools/${SCHOOL_A}/classes`;

    const added = await post(principal, `${classes}/actions`, [
      ['action', 'add-class'],
      ['label', '3A'],
      ['grade_level', '3'],
      ['capacity', '1'],
    ]);
    expect(added).toContain('data-testid="done"');
    const classId = new RegExp(`${classes}/(${UUID})`).exec(added)![1]!;

    // Mila is enrolled under this label, so she finds her seat, and the one place is gone.
    const seated = (await page(principal, `${classes}/${classId}`)).html;
    expect(seated).toContain(`student-${MILA}`);
    expect(seated).toContain('Full');

    const timetable = `/schools/${SCHOOL_A}/timetable`;
    await post(principal, `${timetable}/actions`, [
      ['action', 'add-period'],
      ['position', '9'],
      ['starts', '16:00'],
      ['ends', '16:40'],
    ]);
    const grid = (await page(principal, `${timetable}?of=${classId}`)).html;
    const lesson = await post(principal, `${timetable}/actions`, [
      ['action', 'add-lesson'],
      ['class_id', classId],
      ['weekday', '1'],
      ['period_id', new RegExp(`name="period_id"[^>]*>.*?value="(${UUID})"`, 's').exec(grid)![1]!],
      ['subject', 'Maths'],
      ['teacher_id', new RegExp(`name="teacher_id"[^>]*>.*?value="(${UUID})"`, 's').exec(grid)![1]!],
      ['room_id', new RegExp(`name="room_id"[^>]*>.*?value="(${UUID})"`, 's').exec(grid)![1]!],
    ]);
    expect(lesson).toContain('Maths');

    const today = new Date().toISOString().slice(0, 10);
    const register = `${classes}/${classId}/register`;
    await page(principal, register);
    await post(principal, `${register}/actions`, [
      ['action', 'save-register'],
      ['day', today],
      [`status:${MILA}`, 'late'],
    ]);
    const graded = await post(principal, `${register}/actions`, [
      ['action', 'add-grade'],
      ['student_id', MILA],
      ['subject', 'Maths'],
      ['term', '1'],
      ['value', '6'],
    ]);
    expect(graded).toContain('data-testid="done"');

    const anna = await signedIn('anna.ivanova');
    expect((await page(anna, `/children/${MILA}/timetable`)).html).toContain('Maths');
    const progress = (await page(anna, `/children/${MILA}/progress`)).html;
    expect(progress).toContain('Maths');
    expect(progress).toContain('6');
  });

  it('keeps stock, and refuses more than there is', async () => {
    const principal = await signedIn('principal.a');
    const inventory = `/schools/${SCHOOL_A}/inventory`;

    await post(principal, `${inventory}/actions`, [
      ['action', 'add-supplier'],
      ['name', 'E2E supplier'],
    ]);
    const empty = (await page(principal, inventory)).html;
    const added = await post(principal, `${inventory}/actions`, [
      ['action', 'add-item'],
      ['kind', 'book'],
      ['name', 'E2E atlas'],
      ['reorder_level', '5'],
      ['supplier_id', option(empty, 'supplier_id', 'E2E supplier')],
    ]);
    expect(added).toContain('Reorder');

    const item = option(added, 'item_id', 'E2E atlas');
    const delivered = await post(principal, `${inventory}/actions`, [
      ['action', 'move'],
      ['item_id', item],
      ['reason', 'delivered'],
      ['quantity', '10'],
    ]);
    expect(delivered).toContain('data-testid="done"');
    expect(delivered).not.toContain('>Reorder<');

    const refused = await post(principal, `${inventory}/actions`, [
      ['action', 'move'],
      ['item_id', item],
      ['reason', 'issued'],
      ['quantity', '11'],
    ]);
    expect(refused).toContain('data-testid="error"');

    const teacher = await signedIn('teacher.b');
    expect((await page(teacher, `/schools/${SCHOOL_B}/inventory`)).html).toContain(
      'data-testid="not-permitted"',
    );
  });

  it('records spending against a budget, for those who keep the money', async () => {
    const finance = await signedIn('finance');
    const path = `/schools/${SCHOOL_A}/finance`;

    await post(finance, `${path}/actions`, [
      ['action', 'set-budget'],
      ['category', 'other'],
      ['amount', '1234'],
    ]);
    const spent = await post(finance, `${path}/actions`, [
      ['action', 'add-expense'],
      ['category', 'other'],
      ['description', 'E2E stamps'],
      ['amount', '100.50'],
      ['spent_on', '2026-10-20'],
    ]);
    expect(spent).toContain('E2E stamps');

    const principal = await signedIn('principal.a');
    const seen = (await page(principal, path)).html;
    expect(seen).toContain('E2E stamps');
    expect(seen).not.toContain('data-testid="add-expense"');
  });

  it('shows every school on one screen to those who run the group', async () => {
    const ceo = await signedIn('ceo');
    const overview = (await page(ceo, '/group')).html;
    // Other test files add schools of their own, so look for the three seeded ones.
    expect(overview.match(/data-testid="school-overview"/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    for (const school of [SCHOOL_A, SCHOOL_B, SCHOOL_C])
      expect(overview).toContain(`/schools/${school}/finance`);
    expect(overview).toContain('School A');

    const parent = await signedIn('hristo.georgiev');
    expect((await page(parent, '/group')).html).toContain('data-testid="not-permitted"');
    expect((await page(parent, '/invoices')).html).toContain('data-testid="invoices"');
  });

  it('refuses a form sent from another site', async () => {
    const principal = await signedIn('principal.a');
    const response = await principal.request(`${APP}/schools/${SCHOOL_A}/inventory/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://elsewhere.test' },
      body: new URLSearchParams([['action', 'add-supplier']]),
    });
    expect(response.status).toBe(403);
  });
});
