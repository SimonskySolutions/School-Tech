import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// The enrolment hand-off through the web app (M5.4). A family new to the
// group (invited from an inquiry, so no seeded family gains a child) applies
// for their child; the principal of School A offers the place, the parent
// accepts, the principal enrols the child from today; the parent can then
// book lunch for her at School A.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const KEYCLOAK_ADMIN = readFileSync('/workspace/secrets/keycloak_admin_password', 'utf8').trim();
const KEYCLOAK = 'http://keycloak:8080';
const WEB = 'http://web:3000';
const SITE_A = 'school-a.pythagoras.localhost';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
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
const done = (response: Response) => new URL(response.headers.get('location')!).searchParams;

/** A new family: an inquiry on the School A website, the principal's invitation, the first sign-in. */
async function invitedParent(principal: Browser): Promise<Browser> {
  const email = `test-${run}-e2e-enrol@pythagoras.test`;
  const site = (path: string, init: RequestInit = {}) =>
    fetch(`${WEB}${path}`, {
      ...init,
      headers: { 'x-forwarded-host': `${SITE_A}:53000`, ...(init.headers as Record<string, string>) },
      redirect: 'manual',
    });
  const form = decode(await (await site('/inquiry')).text());
  await site('/inquiry/send', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `http://${SITE_A}:53000` },
    body: new URLSearchParams([
      ['school_id', hidden(form, 'school_id')],
      ['notice_id', hidden(form, 'notice_id')],
      ['parent_name', 'Vera Enrol (e2e test)'],
      ['email', email],
      ['notice_read', 'yes'],
    ]),
  });
  const list = await open(principal, '/admissions/inquiries');
  const at = list.indexOf('<h2>Vera Enrol (e2e test)</h2>');
  const inquiryId = /data-testid="inquiry-([0-9a-f-]{36})"/.exec(
    list.slice(list.lastIndexOf('<article', at)),
  )![1]!;
  const invited = await postForm(principal, '/admissions/inquiries/actions', [
    ['action', 'invite'],
    ['inquiry_id', inquiryId],
    ['given_name', 'Vera'],
    ['family_name', 'Enrol'],
  ]);
  expect(invited.status).toBe(200);
  // Stand in for the parent choosing a password at first sign-in.
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
  const [user] = (await (await admin(`/users?username=${encodeURIComponent(email)}&exact=true`)).json()) as {
    id: string;
  }[];
  const chosen = `Chosen-${run}-Passw0rd`;
  await admin(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) });
  await admin(`/users/${user!.id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: chosen, temporary: false }),
  });
  return (await signIn(email, chosen)).browser;
}

describe('from an accepted place to a child the family books for', () => {
  it('enrols a child new to the group, who then appears among the family’s children', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const grade = `n${run}`;
    const staffAct = (fields: [string, string][]) =>
      postForm(principal, '/admissions/applications/actions', fields);
    expect(
      done(
        await staffAct([
          ['action', 'open-intake'],
          ['school_id', SCHOOL_A],
          ['school_year', '2028/29'],
          ['grade', grade],
          ['places', '1'],
          ['opens_on', day(0)],
          ['closes_on', day(30)],
        ]),
      ).get('done'),
    ).toBe('intake-opened');

    const anna = await invitedParent(principal);
    const form = await open(anna, '/admissions/apply');
    const intakeId = new RegExp(
      `<option value="([0-9a-f-]{36})"[^>]*>School A, grade ${grade}, 2028/29<`,
    ).exec(form)![1]!;
    const applied = await postForm(anna, '/admissions/apply/actions', [
      ['action', 'apply'],
      ['intake_id', intakeId],
      ['notice_id', hidden(form, 'notice_id')],
      ['notice_read', 'yes'],
      ['child', 'new'],
      ['child_given_name', 'Ema'],
      ['child_family_name', 'Ivanova'],
      ['child_birth_date', '2021-07-07'],
    ]);
    expect(done(applied).get('done')).toBe('applied');

    const staff = await open(principal, `/admissions/applications?intakeId=${intakeId}`);
    const applicationId = /data-testid="application-([0-9a-f-]{36})"/.exec(
      staff.slice(staff.indexOf('<h3>Ema Ivanova</h3>') - 400),
    )![1]!;
    expect(
      done(
        await staffAct([
          ['action', 'offer'],
          ['application_id', applicationId],
          ['answer_by', day(7)],
        ]),
      ).get('done'),
    ).toBe('offered');
    expect(
      done(
        await postForm(anna, '/admissions/apply/actions', [
          ['action', 'accept'],
          ['application_id', applicationId],
        ]),
      ).get('done'),
    ).toBe('accepted');

    // The principal enrols the child; for a new child the form asks how Anna is related.
    const accepted = await open(principal, `/admissions/applications?intakeId=${intakeId}`);
    expect(accepted).toContain("Vera Enrol is the child's");
    const missing = await staffAct([
      ['action', 'enrol'],
      ['application_id', applicationId],
      ['new_child', 'yes'],
      ['start_date', day(0)],
    ]);
    expect(done(missing).get('error')).toContain('related');
    const enrolled = await staffAct([
      ['action', 'enrol'],
      ['application_id', applicationId],
      ['new_child', 'yes'],
      ['start_date', day(0)],
      ['class_label', '1A'],
      ['relationship', 'mother'],
    ]);
    expect(done(enrolled).get('done')).toBe('enrolled');
    expect(await open(principal, `/admissions/applications?intakeId=${intakeId}`)).toMatch(
      new RegExp(
        `grade ${grade}, 2028/29</a>: 1 places, 0 free · 1 applications, 0 offered, 0 accepted, 1 enrolled, 0 waiting`,
      ),
    );

    // The parent sees the enrolment and books lunch for Ema.
    const mine = await open(anna, '/admissions/apply');
    expect(mine).toContain(`Ema Ivanova: School A, grade ${grade}, 2028/29 · Enrolled`);
    expect(mine).toContain('href="/services"');
    const emaLine = mine.slice(mine.indexOf('Ema Ivanova: School A'));
    expect(emaLine.slice(0, emaLine.indexOf('</li>'))).not.toContain('data-testid="withdraw"');
    expect(await open(anna, '/')).toMatch(/Ema Ivanova[\s\S]*?School A, class 1A/);
    const services = await open(anna, '/services');
    const section = services.slice(services.indexOf('data-testid="child-Ema"'));
    expect(section).toContain('Lunch at School A');
  });
});
