import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// M5.7: admissions end to end at a school added through administration, with
// no code, migration or configuration change. The group administrator sets
// up School E with its company, lunch, principal and website; its principal
// opens an intake. A family that has never dealt with the group asks about a
// place on School E's website, is invited, applies, is offered the place,
// accepts and is enrolled; the parent buys lunch for the child and pays
// School E's company; School E's kitchen counts the meal, and the numbers show
// the whole path. Test data uses the "test-" prefix and is removed before
// each run.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const ADMIN_PASSWORD = readFileSync('/workspace/secrets/keycloak_admin_password', 'utf8').trim();
const KEYCLOAK = 'http://keycloak:8080';
const WEB = 'http://web:3000';
const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const ENROLMENT_FEE = 'd1000000-0000-7000-8000-00000000000a';
const run = Date.now().toString(36);
const code = `test-${run}-e`;
const schoolName = `School E ${run}`;
const companyName = `Test company ${run} E`;
const PARENT = 'Nadia Petrova (e2e test)';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const page = async (browser: Browser, path: string) =>
  decode(await (await browser.follow(new URL(path, APP).toString())).response.text());
const post = (browser: Browser, path: string, fields: Record<string, string> | [string, string][]) =>
  browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
const done = (response: Response) => new URL(response.headers.get('location')!).searchParams;
const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)![1]!;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function nextMonday(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7));
  return date;
}
const plus = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** Stands in for a new person choosing their own password at first sign-in. */
async function firstSignIn(username: string): Promise<Browser> {
  const admin = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'admin',
      password: ADMIN_PASSWORD,
    }),
  });
  const { access_token } = (await admin.json()) as { access_token: string };
  const call = (path: string, init: RequestInit = {}) =>
    fetch(`${KEYCLOAK}/admin/realms/pythagoras${path}`, {
      ...init,
      headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    });
  const [user] = (await (
    await call(`/users?username=${encodeURIComponent(username)}&exact=true`)
  ).json()) as {
    id: string;
  }[];
  const password = `Chosen-${run}-Passw0rd`;
  await call(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) });
  await call(`/users/${user!.id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  });
  return (await signIn(username, password)).browser;
}

describe('admissions at a school added through administration', () => {
  it('takes a family from an inquiry on the website to a paid lunch for their enrolled child', async () => {
    // 1. The group administrator sets School E up in the web app.
    const admin = (await signIn('admin@pythagoras.test', PASSWORD)).browser;
    const added = await post(admin, '/admin/actions', {
      action: 'create-company',
      back: '/admin/schools',
      legal_name: companyName,
      registration_number: String(Date.now()).slice(-9),
    });
    const overview = await page(admin, added.headers.get('location')!);
    const companyId = new RegExp(`<option value="([0-9a-f-]{36})">${companyName}</option>`).exec(
      overview,
    )![1]!;
    const created = await post(admin, '/admin/actions', {
      action: 'create-school',
      back: '/admin/schools',
      name: schoolName,
      code,
      kind: 'school',
      time_zone: 'Europe/Sofia',
      billing_entity_id: companyId,
    });
    const schoolId = /\/admin\/schools\/([0-9a-f-]{36})/.exec(created.headers.get('location')!)![1]!;
    const back = `/admin/schools/${schoolId}`;
    await post(admin, '/admin/actions', {
      action: 'add-offering',
      back,
      school_id: schoolId,
      service_definition_id: LUNCH,
      name: `Lunch at ${schoolName}`,
      price: '5.40',
      price_unit: 'per_day',
    });
    const setup = await page(admin, back);
    const offeringId = /<select name="offering_id" required=""><option value="([0-9a-f-]{36})"/.exec(
      setup,
    )![1]!;
    const monday = nextMonday();
    await post(admin, '/admin/actions', {
      action: 'add-sessions',
      back,
      school_id: schoolId,
      offering_id: offeringId,
      pattern: 'school_days',
      from: plus(monday, 0),
      to: plus(monday, 4),
      capacity: '60',
      closed: '',
    });
    // An enrolment fee too (M5.8): not sold by session, so it needs no calendar to go live.
    await post(admin, '/admin/actions', {
      action: 'add-offering',
      back,
      school_id: schoolId,
      service_definition_id: ENROLMENT_FEE,
      name: `Enrolment fee, ${schoolName}`,
      price: '100.00',
      price_unit: 'one_off',
    });
    const principalEmail = `test-${run}-e-principal@pythagoras.test`;
    await post(admin, '/admin/actions', {
      action: 'add-staff',
      back,
      school_id: schoolId,
      given_name: 'Elka',
      family_name: 'Principal',
      email: principalEmail,
      role_code: 'principal',
    });
    const principalId = /data-testid="create-account-([0-9a-f-]{36})"/.exec(await page(admin, back))![1]!;
    expect(
      (await post(admin, '/admin/actions', { action: 'create-account', back, person_id: principalId }))
        .status,
    ).toBe(200);
    await post(admin, '/admin/actions', { action: 'create-website', back, school_id: schoolId });
    const activated = await post(admin, '/admin/actions', { action: 'activate', back, school_id: schoolId });
    expect(await page(admin, activated.headers.get('location')!)).toContain('Status: active.');

    // 2. School E's principal signs in and opens an intake.
    const principal = await firstSignIn(principalEmail);
    expect(await page(principal, '/')).toContain('href="/admissions/applications"');
    const staffAct = (fields: [string, string][]) =>
      post(principal, '/admissions/applications/actions', fields);
    expect(
      done(
        await staffAct([
          ['action', 'open-intake'],
          ['school_id', schoolId],
          ['school_year', '2027/28'],
          ['grade', '1'],
          ['places', '12'],
          ['opens_on', day(0)],
          ['closes_on', day(30)],
        ]),
      ).get('done'),
    ).toBe('intake-opened');

    // 3. A family new to the group asks about a place on School E's website.
    const site = (path: string, init: RequestInit = {}) =>
      fetch(`${WEB}${path}`, {
        ...init,
        headers: {
          'x-forwarded-host': `${code}.pythagoras.localhost:53000`,
          ...(init.headers as Record<string, string>),
        },
        redirect: 'manual',
      });
    expect(await (await site('/')).text()).toContain('href="/inquiry"');
    const form = decode(await (await site('/inquiry')).text());
    expect(form).toContain(`name="school_id" value="${schoolId}"`);
    const parentEmail = `test-${run}-e-parent@pythagoras.test`;
    const sent = await site('/inquiry/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: `http://${code}.pythagoras.localhost:53000`,
      },
      body: new URLSearchParams([
        ['school_id', schoolId],
        ['notice_id', hidden(form, 'notice_id')],
        ['parent_name', PARENT],
        ['email', parentEmail],
        ['child_name', 'Iva'],
        ['birth_year', '2021'],
        ['grade', '1'],
        ['message', 'We are moving to the area. Is there a place in grade 1?'],
        ['notice_read', 'yes'],
      ]),
    });
    expect(sent.headers.get('location')).toContain('result=sent');

    // 4. The principal sees the inquiry, logs a call and invites the family to apply.
    const inquiries = await page(principal, '/admissions/inquiries');
    const at = inquiries.indexOf(`<h2>${PARENT}</h2>`);
    expect(at).toBeGreaterThan(-1);
    const inquiryId = /data-testid="inquiry-([0-9a-f-]{36})"/.exec(
      inquiries.slice(inquiries.lastIndexOf('<article', at)),
    )![1]!;
    const inquiryAct = (fields: [string, string][]) =>
      post(principal, '/admissions/inquiries/actions', fields);
    expect(
      done(
        await inquiryAct([
          ['action', 'note'],
          ['inquiry_id', inquiryId],
          ['kind', 'call'],
          ['body', 'Called; invited to apply.'],
        ]),
      ).get('done'),
    ).toBe('noted');
    const invited = await inquiryAct([
      ['action', 'invite'],
      ['inquiry_id', inquiryId],
      ['given_name', 'Nadia'],
      ['family_name', 'Petrova'],
    ]);
    expect(await invited.text()).toMatch(/data-testid="temporary-password"[^>]*>[A-Za-z0-9]{24}</);

    // 5. The parent signs in for the first time and applies for Iva.
    const parent = await firstSignIn(parentEmail);
    const apply = await page(parent, '/admissions/apply');
    const intakeId = new RegExp(`<option value="([0-9a-f-]{36})"[^>]*>${schoolName}, grade 1, 2027/28<`).exec(
      apply,
    )![1]!;
    const intakesPage = await page(principal, '/admissions/applications');
    const feeId = new RegExp(`<option value="([0-9a-f-]{36})">Enrolment fee, ${schoolName}, 100,00`).exec(
      intakesPage,
    )![1]!;
    expect(
      done(
        await staffAct([
          ['action', 'set-fee'],
          ['intake_id', intakeId],
          ['offering_id', feeId],
        ]),
      ).get('done'),
    ).toBe('fee-set');
    const applied = await post(parent, '/admissions/apply/actions', [
      ['action', 'apply'],
      ['intake_id', intakeId],
      ['notice_id', hidden(apply, 'notice_id')],
      ['notice_read', 'yes'],
      ['child', 'new'],
      ['child_given_name', 'Iva'],
      ['child_family_name', 'Petrova'],
      ['child_birth_date', '2021-02-02'],
    ]);
    expect(done(applied).get('done')).toBe('applied');

    // 6. Offer, acceptance and enrolment from today.
    const applications = await page(principal, `/admissions/applications?intakeId=${intakeId}`);
    const applicationId = /data-testid="application-([0-9a-f-]{36})"/.exec(
      applications.slice(applications.indexOf('<h3>Iva Petrova</h3>') - 400),
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
        await post(parent, '/admissions/apply/actions', [
          ['action', 'accept'],
          ['application_id', applicationId],
        ]),
      ).get('done'),
    ).toBe('accepted');
    expect(
      done(
        await staffAct([
          ['action', 'enrol'],
          ['application_id', applicationId],
          ['new_child', 'yes'],
          ['start_date', day(0)],
          ['class_label', '1E'],
          ['relationship', 'mother'],
        ]),
      ).get('done'),
    ).toBe('enrolled');
    expect(await page(parent, '/admissions/apply')).toContain(
      `Iva Petrova: ${schoolName}, grade 1, 2027/28 · Enrolled`,
    );
    expect(await page(parent, '/admissions/apply')).toMatch(
      new RegExp(`Enrolment fee, ${schoolName}: pay 100,00\\s?€`),
    );

    // 7. The parent buys a day of lunch for Iva and pays School E's company.
    const services = await page(parent, '/services');
    expect(services).toContain(`Lunch at ${schoolName}`);
    const choice = (services.match(/<input[^>]*type="checkbox"[^>]*name="lunch"[^>]*>/g) ?? [])
      .filter((input) => !/\sdisabled(=""|\s|>|\/)/.test(input))
      .map((input) => decode(/value="([^"]+)"/.exec(input)![1]!))
      .find((value) => value.split('|')[1] === offeringId)!;
    expect(choice).toBeTruthy();
    const placed = await post(parent, '/checkout', [
      ['idempotency_key', hidden(services, 'idempotency_key')],
      ['lunch', choice],
    ]);
    // One company in the basket: straight to the (development) payment page, then back to the order.
    const checkoutUrl = placed.headers.get('location')!;
    const provider = await (await parent.follow(checkoutUrl)).response.text();
    const payAction = decode(/<form method="post" action="([^"]+\/succeed)"/.exec(provider)![1]!);
    const paid = await parent.request(new URL(payAction, checkoutUrl).toString(), { method: 'POST' });
    const orderUrl = new URL(paid.headers.get('location')!, APP).toString();
    let order = '';
    for (let tries = 0; tries < 40 && !order.includes('data-status="paid"'); tries += 1) {
      if (tries > 0) await new Promise((resolve) => setTimeout(resolve, 500));
      order = await page(parent, orderUrl);
    }
    expect(order).toContain(`Billed by ${companyName}.`);
    expect(order).toContain('data-status="paid"');

    // 8. School E's kitchen counts the meal, and the numbers show the whole path.
    const kitchen = await page(principal, '/school-life/kitchen?days=10');
    expect(kitchen.slice(kitchen.indexOf(`data-testid="kitchen-${schoolName}"`))).toMatch(
      /data-testid="meals">1</,
    );
    const numbers = await page(principal, '/admissions/pipeline');
    const row = numbers.slice(numbers.indexOf(`data-testid="pipeline-intake-${intakeId}"`));
    // Places 12, free 11; new 0, waiting 0, offered 0, accepted 0, enrolled 1, not placed 0, from an inquiry 1.
    expect(row.slice(0, row.indexOf('</tr>'))).toMatch(
      /grade 1, 2027\/28<\/td><td[^>]*>12<\/td><td[^>]*>11<\/td><td[^>]*>0<\/td><td[^>]*>0<\/td><td[^>]*>0<\/td><td[^>]*>0<\/td><td[^>]*>1<\/td><td[^>]*>0<\/td><td[^>]*>1<\/td>/,
    );
    const ceo = (await signIn('ceo@pythagoras.test', PASSWORD)).browser;
    const ceoNumbers = await page(ceo, '/admissions/pipeline');
    expect(ceoNumbers).toContain(`data-testid="pipeline-intake-${intakeId}"`);
    expect(ceoNumbers).not.toContain('Iva');
    expect(ceoNumbers).not.toContain('Nadia');
  });
});
