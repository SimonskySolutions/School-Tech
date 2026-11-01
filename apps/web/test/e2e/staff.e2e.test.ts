import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Staff records through the web app (M6.1, ADR 0028): the principal of
// School A sees the staff page, records and ends an employment; the kitchen
// sees only its own employment; colleagues and other schools see nothing; a
// role without an employment is flagged at School C.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_C = 'b1000000-0000-7000-8000-00000000000c';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const postForm = (browser: Browser, path: string, fields: [string, string][], origin = APP) =>
  browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);

describe('staff records', () => {
  it('lets the principal of School A see, record and end employments', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(principal, '/')).toContain(`href="/schools/${SCHOOL_A}/staff"`);
    const page = await open(principal, `/schools/${SCHOOL_A}/staff`);
    expect(page).toContain('Staff at School A');
    const kitchen = page.slice(page.indexOf(`data-testid="staff-${KITCHEN_A}"`));
    expect(kitchen.slice(0, kitchen.indexOf('</article>'))).toContain(
      'Cook, permanent, 75% of full time, with Testing Company, from 2025-01-15',
    );
    // Testing Company by name: other test files add companies that may sort first.
    const employers = page.slice(
      page.indexOf('name="employer_id"'),
      page.indexOf('</select>', page.indexOf('name="employer_id"')),
    );
    const employerId = /<option value="([0-9a-f-]{36})"[^>]*>Testing Company</.exec(employers)![1]!;
    const act = (fields: [string, string][]) =>
      postForm(principal, `/schools/${SCHOOL_A}/staff/actions`, fields);
    const fields: [string, string][] = [
      ['action', 'record'],
      ['person_id', KITCHEN_A],
      ['employer_id', employerId],
      ['position', 'Lunch supervisor (e2e test)'],
      ['contract_kind', 'fixed_term'],
      ['working_time', '20'],
      ['start_date', '2026-11-01'],
    ];
    expect(notice(await act(fields), 'error')).toContain('end date');
    expect(notice(await act([...fields, ['end_date', '2027-06-30']]), 'done')).toBe('recorded');
    const after = await open(principal, `/schools/${SCHOOL_A}/staff`);
    expect(after).toContain(
      'Lunch supervisor (e2e test), fixed term, 20% of full time, with Testing Company, from 2026-11-01 to 2027-06-30',
    );
    const employmentId = /data-testid="employment-([0-9a-f-]{36})"/.exec(
      after.slice(
        after.lastIndexOf('data-testid="employment-', after.indexOf('Lunch supervisor (e2e test)')),
      ),
    )![1]!;
    expect(
      notice(
        await act([
          ['action', 'end'],
          ['employment_id', employmentId],
          ['end_date', '2027-01-31'],
        ]),
        'done',
      ),
    ).toBe('ended');
    expect(await open(principal, `/schools/${SCHOOL_A}/staff`)).toContain('from 2026-11-01 to 2027-01-31');
    expect(
      (await postForm(principal, `/schools/${SCHOOL_A}/staff/actions`, fields, 'http://evil.example')).status,
    ).toBe(403);
  });

  it('shows the kitchen its own employment and nobody else’s', async () => {
    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    const mine = await open(kitchen, '/staff/me');
    expect(mine).toContain('Cook at School A, permanent, 75% of full time, with Testing Company');
    expect(await open(kitchen, `/schools/${SCHOOL_A}/staff`)).toContain('data-testid="not-permitted"');
    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    expect(await open(teacher, `/schools/${SCHOOL_A}/staff`)).toContain('data-testid="not-permitted"');
  });

  it('flags a role without an employment at School C', async () => {
    const principal = (await signIn('principal.c@pythagoras.test', PASSWORD)).browser;
    const page = await open(principal, `/schools/${SCHOOL_C}/staff`);
    expect(page).toContain('Has a role here but no current employment');
    expect(await open(principal, '/staff/me')).toContain('No employment is recorded for you.');
  });
});
