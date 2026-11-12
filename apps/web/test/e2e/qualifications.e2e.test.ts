import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Qualifications and checks through the web app (M6.2): the principal of
// School A sees what needs attention, notes the kitchen's record check (dates
// only) and adds a qualification; the kitchen sees its own records.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
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

describe('qualifications and checks', () => {
  it('shows what needs attention, and clears it once the check is noted', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const page = await open(principal, `/schools/${SCHOOL_A}/staff`);
    const attention = section(page, 'needs-attention');
    expect(attention).toContain('Radka Mineva: no criminal record check');
    expect(attention).toContain(
      'Petar Nikolov: record check ends within 60 days; a qualification ends within 60 days',
    );
    expect(page).toContain('Record only the dates: never keep the certificate or what it says.');

    const act = (fields: [string, string][]) =>
      postForm(principal, `/schools/${SCHOOL_A}/staff/actions`, fields);
    expect(
      notice(
        await act([
          ['action', 'check'],
          ['person_id', KITCHEN_A],
          ['seen_on', day(0)],
          ['valid_until', day(-1)],
        ]),
        'error',
      ),
    ).toContain('valid until');
    expect(
      notice(
        await act([
          ['action', 'check'],
          ['person_id', KITCHEN_A],
          ['seen_on', day(0)],
          ['valid_until', day(180)],
        ]),
        'done',
      ),
    ).toBe('checked');
    expect(
      notice(
        await act([
          ['action', 'qualify'],
          ['person_id', KITCHEN_A],
          ['kind', 'first_aid'],
          ['title', 'First aid (e2e test)'],
          ['awarded_on', day(-10)],
          ['expires_on', day(20)],
        ]),
        'done',
      ),
    ).toBe('qualified');
    const after = await open(principal, `/schools/${SCHOOL_A}/staff`);
    expect(section(after, 'needs-attention')).toContain('Radka Mineva: a qualification ends within 60 days');
    expect(section(after, 'needs-attention')).not.toContain('Radka Mineva: no criminal record check');

    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const mine = await open(kitchen, '/staff/me');
    expect(mine).toContain(`Certificate seen ${day(0)}, valid until ${day(180)} (valid).`);
    expect(mine).toContain('First aid: First aid (e2e test)');
  });
});
