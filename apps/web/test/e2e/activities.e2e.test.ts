import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Activity eligibility and attendance through the web app (M4.2). In the
// seed Mila (grade 3) may take chess but not debate (grades 5-7). Marking a
// meeting that has started is covered by the API integration tests, which can
// move a meeting into the past; here the pages and forms are checked.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const DEBATE = 'd2000000-0000-7000-8000-0000000000a5';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");

async function postForm(browser: Browser, path: string, fields: [string, string][], origin = APP) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
}

const setDebateGrades = (browser: Browser, grades: string) =>
  postForm(browser, '/admin/actions', [
    ['action', 'set-eligibility'],
    ['school_id', SCHOOL_A],
    ['offering_id', DEBATE],
    ['back', `/admin/schools/${SCHOOL_A}`],
    ['grades', grades],
    ['min_age', ''],
    ['max_age', ''],
  ]);

let admin: Browser | null = null;
afterAll(async () => {
  if (admin) await setDebateGrades(admin, '5, 6, 7');
});

/** Mila's debate checkbox and its label. */
async function milaDebate(anna: Browser): Promise<string> {
  const page = decode(await (await anna.follow(`${APP}/services`)).response.text());
  const start = page.indexOf(`value="${MILA}|${DEBATE}"`);
  expect(start).toBeGreaterThan(-1);
  return page.slice(page.lastIndexOf('<input', start), page.indexOf('</label>', start));
}

describe('eligibility on the booking page', () => {
  it('shows Anna why Mila cannot book the debate club, and who the chess club is for', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const debate = await milaDebate(anna);
    expect(debate).toMatch(/<input[^>]*disabled/);
    expect(debate).toContain('(cannot be booked: for grades 5, 6, 7 only)');
    const page = decode(await (await anna.follow(`${APP}/services`)).response.text());
    expect(page).toContain('Chess club, School A (grades 2, 3, 4, 5, 6, 7)');
  });

  it('lets the administrator change who may take the club on the set-up page', async () => {
    admin = (await signIn('admin@pythagoras.test', PASSWORD)).browser;
    const setup = decode(await (await admin.follow(`${APP}/admin/schools/${SCHOOL_A}`)).response.text());
    expect(setup).toContain('Who may take it: grades 5, 6, 7');

    const saved = await setDebateGrades(admin, '3, 5');
    expect(saved.status).toBe(303);
    const back = decode(
      await (await admin.follow(new URL(saved.headers.get('location')!, APP).toString())).response.text(),
    );
    expect(back).toContain('Saved who may take it.');
    expect(back).toContain('Who may take it: grades 3, 5');

    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const debate = await milaDebate(anna);
    expect(debate).not.toMatch(/<input[^>]*disabled/);
    expect(debate).not.toContain('cannot be booked');
  });

  it('refuses wrong ages on the set-up form with a notice', async () => {
    const browser = (await signIn('admin@pythagoras.test', PASSWORD)).browser;
    const response = await postForm(browser, '/admin/actions', [
      ['action', 'set-eligibility'],
      ['school_id', SCHOOL_A],
      ['offering_id', DEBATE],
      ['back', `/admin/schools/${SCHOOL_A}`],
      ['min_age', '9'],
      ['max_age', '7'],
    ]);
    expect(new URL(response.headers.get('location')!, APP).searchParams.get('error')).toBe(
      'the minimum age is above the maximum',
    );
  });
});

describe('attendance', () => {
  it("shows Anna Mila's club meetings, and keeps other parents out", async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const home = await (await anna.follow(`${APP}/`)).response.text();
    expect(home).toContain(`href="/children/${MILA}/activities"`);
    const page = await (await anna.follow(`${APP}/children/${MILA}/activities`)).response.text();
    expect(page).toContain('Clubs and attendance: Mila Ivanova');
    const hristo = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    const refused = await (await hristo.follow(`${APP}/children/${MILA}/activities`)).response.text();
    expect(refused).toContain('data-testid="not-permitted"');
  });

  it('refuses attendance forms from another site, and explains a refusal', async () => {
    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      schoolLife,
      '/school-life/attendance',
      [
        ['booking_id', MILA],
        ['status', 'attended'],
      ],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
    const unknown = await postForm(schoolLife, '/school-life/attendance', [
      ['booking_id', MILA],
      ['status', 'attended'],
    ]);
    expect(unknown.status).toBe(303);
    const back = await (
      await schoolLife.follow(new URL(unknown.headers.get('location')!, APP).toString())
    ).response.text();
    expect(back).toContain('data-testid="notice"');
    expect(back).toContain('Club registers');
  });
});
