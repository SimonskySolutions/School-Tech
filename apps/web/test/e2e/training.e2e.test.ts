import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Professional development through the web app (M6.3): the principal of
// School B sees the school year's hours, the teacher adds their own training
// on their records page and the principal's view counts it.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_B = 'b1000000-0000-7000-8000-00000000000b';
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const postForm = (browser: Browser, path: string, fields: [string, string][]) =>
  browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);
const section = (page: string, testId: string) => {
  const start = page.indexOf(`data-testid="${testId}"`);
  return page.slice(start, page.indexOf('</section>', start));
};

describe('professional development', () => {
  it('lets the teacher add their own training, and the principal count it', async () => {
    const principal = (await signIn('principal.b@pythagoras.test', PASSWORD)).browser;
    const before = section(await open(principal, `/schools/${SCHOOL_B}/staff`), 'development');
    expect(before).toMatch(/Professional development, \d{4}\/\d{2}/);
    expect(before).toContain('Viktor Popov: 8 h attended');

    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    const mine = await open(teacher, '/staff/me');
    expect(mine).toContain('data-testid="my-training"');
    expect(mine).toContain('Teaching with manipulatives (synthetic)');
    const add = (fields: [string, string][]) =>
      postForm(teacher, '/staff/me/actions', [['action', 'train'], ['kind', 'workshop'], ...fields]);
    expect(
      notice(
        await add([
          ['title', 'Assessment workshop (e2e test)'],
          ['starts_on', day(-1)],
          ['hours', 'many'],
          ['status', 'attended'],
        ]),
        'error',
      ),
    ).toContain('hours');
    expect(
      notice(
        await add([
          ['title', 'Assessment workshop (e2e test)'],
          ['provider', 'Regional centre'],
          ['starts_on', day(-1)],
          ['hours', '2,5'],
          ['status', 'attended'],
        ]),
        'done',
      ),
    ).toBe('trained');
    expect(await open(teacher, '/staff/me')).toContain('Assessment workshop (e2e test), Regional centre');

    const after = section(await open(principal, `/schools/${SCHOOL_B}/staff`), 'development');
    expect(after).toContain('Viktor Popov: 10.5 h attended');
    // Someone else's records page acts only for the signed-in person.
    const forbidden = await teacher.request(`${APP}/staff/me/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://elsewhere.test' },
      body: new URLSearchParams([['action', 'train']]),
    });
    expect(forbidden.status).toBe(403);
  });
});
