import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Offers through the web app (M5.3). The principal of School A opens an
// intake with one place; Anna and Hristo apply; the principal offers the
// place to Anna, puts Hristo on the waiting list and writes an interview
// note; Anna sees the offer with its deadline and declines; Hristo is
// offered the place and accepts. Neither family sees the note.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KALINA = 'c1000000-0000-7000-8000-000000000032';
const run = Date.now().toString(36);
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)![1]!;
const postForm = (browser: Browser, path: string, fields: [string, string][]) =>
  browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);
/** The id in the data-testid of the element that holds `text`. */
const idOf = (page: string, prefix: string, text: string) => {
  const at = page.indexOf(text);
  expect(at).toBeGreaterThan(-1);
  return new RegExp(`data-testid="${prefix}-([0-9a-f-]{36})"`).exec(
    page.slice(page.lastIndexOf(`data-testid="${prefix}-`, at)),
  )![1]!;
};

describe('an intake with one place', () => {
  it('offers the place, passes a declined offer on, and keeps notes with the staff', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const grade = `p${run}`;
    expect(
      notice(
        await postForm(principal, '/admissions/applications/actions', [
          ['action', 'open-intake'],
          ['school_id', SCHOOL_A],
          ['school_year', '2028/29'],
          ['grade', grade],
          ['places', '1'],
          ['opens_on', day(0)],
          ['closes_on', day(30)],
        ]),
        'done',
      ),
    ).toBe('intake-opened');

    const apply = async (browser: Browser, child: [string, string][]) => {
      const page = await open(browser, '/admissions/apply');
      const intakeId = new RegExp(
        `<option value="([0-9a-f-]{36})"[^>]*>School A, grade ${grade}, 2028/29<`,
      ).exec(page)![1]!;
      const response = await postForm(browser, '/admissions/apply/actions', [
        ['action', 'apply'],
        ['intake_id', intakeId],
        ['notice_id', hidden(page, 'notice_id')],
        ['notice_read', 'yes'],
        ...child,
      ]);
      expect(notice(response, 'done')).toBe('applied');
    };
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    await apply(anna, [
      ['child', 'new'],
      ['child_given_name', 'Ola'],
      ['child_family_name', 'Ivanova'],
      ['child_birth_date', '2021-04-04'],
    ]);
    const hristo = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    await apply(hristo, [['child', KALINA]]);

    // The principal offers the place to Anna's child and puts Hristo's on the waiting list.
    const staff = await open(principal, '/admissions/applications');
    const ola = idOf(staff, 'application', '<h3>Ola Ivanova</h3>');
    const kalina = idOf(staff, 'application', '<h3>Kalina Georgieva</h3>');
    const act = (fields: [string, string][]) =>
      postForm(principal, '/admissions/applications/actions', fields);
    expect(
      notice(
        await act([
          ['action', 'offer'],
          ['application_id', ola],
          ['answer_by', day(7)],
        ]),
        'done',
      ),
    ).toBe('offered');
    expect(
      notice(
        await act([
          ['action', 'offer'],
          ['application_id', kalina],
          ['answer_by', day(7)],
        ]),
        'error',
      ),
    ).toContain('no place left');
    expect(
      notice(
        await act([
          ['action', 'waitlist'],
          ['application_id', kalina],
        ]),
        'done',
      ),
    ).toBe('waitlisted');
    expect(
      notice(
        await act([
          ['action', 'note'],
          ['application_id', kalina],
          ['kind', 'interview'],
          ['body', 'Calm at the visit (e2e test).'],
        ]),
        'done',
      ),
    ).toBe('noted');
    const after = await open(principal, '/admissions/applications');
    expect(after).toContain(`School A, grade ${grade}, 2028/29`);
    expect(after).toMatch(
      new RegExp(
        `grade ${grade}, 2028/29</a>: 1 places, 0 free · 2 applications, 1 offered, 0 accepted, 0 enrolled, 1 waiting`,
      ),
    );
    expect(after).toContain('Interview, Petar Nikolov, ');
    expect(after).toContain('Number 1 on the waiting list');

    // Anna sees the offer and its deadline, and declines; the place goes to Hristo.
    const annaPage = await open(anna, '/admissions/apply');
    expect(annaPage).toMatch(
      new RegExp(`Ola Ivanova: School A, grade ${grade}, 2028/29 · Place offered, answer by \\w+ \\d+ \\w+`),
    );
    expect(annaPage).not.toContain('Calm at the visit');
    const hristoWaiting = await open(hristo, '/admissions/apply');
    expect(hristoWaiting).toContain(
      `Kalina Georgieva: School A, grade ${grade}, 2028/29 · On the waiting list (number 1)`,
    );
    expect(hristoWaiting).not.toContain('Calm at the visit');
    expect(
      notice(
        await postForm(anna, '/admissions/apply/actions', [
          ['action', 'decline'],
          ['application_id', ola],
        ]),
        'done',
      ),
    ).toBe('declined');
    expect(await open(anna, '/admissions/apply')).toContain(
      `Ola Ivanova: School A, grade ${grade}, 2028/29 · Offer declined`,
    );
    const hristoOffered = await open(hristo, '/admissions/apply');
    expect(hristoOffered).toContain(
      `Kalina Georgieva: School A, grade ${grade}, 2028/29 · Place offered, answer by`,
    );
    expect(
      notice(
        await postForm(hristo, '/admissions/apply/actions', [
          ['action', 'accept'],
          ['application_id', kalina],
        ]),
        'done',
      ),
    ).toBe('accepted');
    expect(await open(hristo, '/admissions/apply')).toContain(
      `Kalina Georgieva: School A, grade ${grade}, 2028/29 · Place accepted`,
    );
    expect(await open(principal, '/admissions/applications')).toMatch(
      new RegExp(
        `grade ${grade}, 2028/29</a>: 1 places, 0 free · 1 applications, 0 offered, 1 accepted, 0 enrolled, 0 waiting`,
      ),
    );
  });
});
