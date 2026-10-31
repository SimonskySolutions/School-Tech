import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Applications through the web app (M5.2, ADR 0027). Anna applies on the
// portal for Boris and for a child the group does not know yet; the principal
// of School A takes Boris's application into review and opens an intake. A
// family that only sent an inquiry from the School A website is invited,
// chooses a password and applies.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const KEYCLOAK_ADMIN = readFileSync('/workspace/secrets/keycloak_admin_password', 'utf8').trim();
const KEYCLOAK = 'http://keycloak:8080';
const WEB = 'http://web:3000';
const SITE_A = 'school-a.pythagoras.localhost';
const BORIS = 'c1000000-0000-7000-8000-000000000031';
const INTAKE = 'db000000-0000-7000-8000-0000000000a1';
const run = Date.now().toString(36);
const APPLICANT = `test-${run}-e2e-applicant@pythagoras.test`;

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const open = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(`${APP}${path}`)).response.text());
const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)![1]!;

async function postForm(browser: Browser, path: string, fields: [string, string][], origin = APP) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
}
const notice = (response: Response, name: string) =>
  new URL(response.headers.get('location')!).searchParams.get(name);

/** Stands in for a new parent choosing their own password at first sign-in. */
async function choosePassword(username: string, chosen: string) {
  const token = (await (
    await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'admin',
        password: KEYCLOAK_ADMIN,
      }),
    })
  ).json()) as { access_token: string };
  const admin = (path: string, init: RequestInit = {}) =>
    fetch(`${KEYCLOAK}/admin/realms/pythagoras${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token.access_token}`, 'content-type': 'application/json' },
    });
  const [user] = (await (
    await admin(`/users?username=${encodeURIComponent(username)}&exact=true`)
  ).json()) as {
    id: string;
  }[];
  await admin(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) });
  await admin(`/users/${user!.id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: chosen, temporary: false }),
  });
}

describe('a family that attends applies for a place', () => {
  it('lets Anna apply for Boris and for a new child, and follow her applications', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    expect(await open(anna, '/')).toContain('href="/admissions/apply"');
    const page = await open(anna, '/admissions/apply');
    expect(page).toContain('School A, grade 1, 2027/28: 20 places');
    expect(page).toContain(`<option value="${BORIS}">Boris Ivanov</option>`);
    expect(page).toContain('SYNTHETIC NOTICE FOR DEVELOPMENT');
    expect(page).toMatch(new RegExp(`<option value="${INTAKE}"[^>]*>School A, grade 1, 2027/28</option>`));
    const intakeId = INTAKE;
    const fields = (extra: [string, string][]): [string, string][] => [
      ['action', 'apply'],
      ['intake_id', intakeId],
      ['notice_id', hidden(page, 'notice_id')],
      ['notice_read', 'yes'],
      ...extra,
    ];
    const boris = await postForm(
      anna,
      '/admissions/apply/actions',
      fields([
        ['child', BORIS],
        ['message', 'Boris would join his sister.'],
      ]),
    );
    expect(notice(boris, 'done')).toBe('applied');
    const again = await postForm(anna, '/admissions/apply/actions', fields([['child', BORIS]]));
    expect(notice(again, 'error')).toContain('one application per child');
    const nia = await postForm(
      anna,
      '/admissions/apply/actions',
      fields([
        ['child', 'new'],
        ['child_given_name', 'Nia'],
        ['child_family_name', 'Ivanova'],
        ['child_birth_date', '2021-02-03'],
      ]),
    );
    expect(notice(nia, 'done')).toBe('applied');
    const mine = await open(anna, '/admissions/apply');
    expect(mine).toContain('Boris Ivanov: School A, grade 1, 2027/28 · Submitted');
    expect(mine).toContain('Nia Ivanova: School A, grade 1, 2027/28 · Submitted');

    const hristo = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    const theirs = await open(hristo, '/admissions/apply');
    expect(theirs).not.toContain('Boris Ivanov');
    expect(theirs).toContain('You have not applied yet.');
  });

  it('lets the principal of School A review it and open an intake, and nobody else', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(principal, '/')).toContain('href="/admissions/applications"');
    const page = await open(principal, '/admissions/applications');
    const start = page.indexOf('<h3>Boris Ivanov</h3>');
    expect(start).toBeGreaterThan(-1);
    const article = page.slice(page.lastIndexOf('<article', start), page.indexOf('</article>', start));
    expect(article).toContain('Born 2020-05-20');
    expect(article).toContain('Already at one of our schools');
    expect(article).toContain('Parent: Anna Ivanova, anna.ivanova@pythagoras.test');
    const applicationId = /data-testid="application-([0-9a-f-]{36})"/.exec(article)![1]!;
    const reviewed = await postForm(principal, '/admissions/applications/actions', [
      ['action', 'review'],
      ['application_id', applicationId],
    ]);
    expect(notice(reviewed, 'done')).toBe('reviewed');
    expect(await open(principal, '/admissions/applications')).toMatch(
      new RegExp(`data-testid="application-${applicationId}"[\\s\\S]*?Under review`),
    );
    const opened = await postForm(principal, '/admissions/applications/actions', [
      ['action', 'open-intake'],
      ['school_id', 'b1000000-0000-7000-8000-00000000000a'],
      ['school_year', '2028/29'],
      ['grade', `e${run}`],
      ['places', '12'],
      ['opens_on', new Date().toISOString().slice(0, 10)],
      ['closes_on', new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10)],
    ]);
    expect(notice(opened, 'done')).toBe('intake-opened');
    expect(await open(principal, '/admissions/applications')).toContain(`School A, grade e${run}, 2028/29`);

    const kitchen = (await signIn('kitchen.a@pythagoras.test', PASSWORD)).browser;
    expect(await open(kitchen, '/admissions/applications')).toContain('data-testid="not-permitted"');
    const otherSchool = (await signIn('principal.c@pythagoras.test', PASSWORD)).browser;
    expect(await open(otherSchool, '/admissions/applications')).not.toContain('Boris Ivanov</h3>');
    const crossSite = await postForm(
      principal,
      '/admissions/applications/actions',
      [['action', 'review']],
      'http://evil.example',
    );
    expect(crossSite.status).toBe(403);
  });
});

describe('a family that only asked is invited and applies', () => {
  it('invites the sender of an inquiry, who chooses a password and applies', async () => {
    const site = (path: string, init: RequestInit = {}) =>
      fetch(`${WEB}${path}`, {
        ...init,
        headers: { 'x-forwarded-host': `${SITE_A}:53000`, ...(init.headers as Record<string, string>) },
        redirect: 'manual',
      });
    const form = decode(await (await site('/inquiry')).text());
    const sent = await site('/inquiry/send', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://${SITE_A}:53000` },
      body: new URLSearchParams([
        ['school_id', hidden(form, 'school_id')],
        ['notice_id', hidden(form, 'notice_id')],
        ['parent_name', 'Vera Applicant (e2e test)'],
        ['email', APPLICANT],
        ['notice_read', 'yes'],
      ]),
    });
    expect(sent.headers.get('location')).toContain('result=sent');

    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const list = await open(principal, '/admissions/inquiries');
    const start = list.indexOf('<h2>Vera Applicant (e2e test)</h2>');
    const article = list.slice(list.lastIndexOf('<article', start), list.indexOf('</article>', start));
    expect(article).toContain('value="Vera"');
    expect(article).toContain('value="Applicant"');
    const inquiryId = /data-testid="inquiry-([0-9a-f-]{36})"/.exec(article)![1]!;
    const answer = await postForm(principal, '/admissions/inquiries/actions', [
      ['action', 'invite'],
      ['inquiry_id', inquiryId],
      ['given_name', 'Vera'],
      ['family_name', 'Applicant'],
    ]);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    const shown = await answer.text();
    expect(shown).toContain(`data-testid="new-username">${APPLICANT}</code>`);
    expect(shown).toMatch(/data-testid="temporary-password"[^>]*>[A-Za-z0-9]{24}</);
    expect(await open(principal, '/admissions/inquiries')).toContain('Invited to apply');

    const chosen = `Chosen-${run}-Passw0rd`;
    await choosePassword(APPLICANT, chosen);
    const parent = (await signIn(APPLICANT, chosen)).browser;
    const page = await open(parent, '/admissions/apply');
    expect(page).toContain('School A, grade 1, 2027/28');
    expect(page).not.toContain('Boris Ivanov');
    const intakeId = INTAKE;
    const applied = await postForm(parent, '/admissions/apply/actions', [
      ['action', 'apply'],
      ['intake_id', intakeId],
      ['notice_id', hidden(page, 'notice_id')],
      ['notice_read', 'yes'],
      ['child', 'new'],
      ['child_given_name', 'Lia'],
      ['child_family_name', 'Applicant'],
      ['child_birth_date', '2021-06-01'],
    ]);
    expect(notice(applied, 'done')).toBe('applied');
    expect(await open(parent, '/admissions/apply')).toContain(
      'Lia Applicant: School A, grade 1, 2027/28 · Submitted',
    );
    expect(await open(parent, '/school-life/kitchen')).toContain('data-testid="not-permitted"');
  });
});
