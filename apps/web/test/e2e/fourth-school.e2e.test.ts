import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// M3.7: a fourth school, from nothing to a working school, with no code,
// migration or configuration change. The group administrator sets it up in
// the web app; its new principal signs in and enrols Anna's third child;
// Anna buys lunch at School D and School A in one basket and pays both
// companies; School D's kitchen and the CEO see it; School D's website is
// live. Test data uses the "test-" prefix and is removed before each run.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const ADMIN_PASSWORD = readFileSync('/workspace/secrets/keycloak_admin_password', 'utf8').trim();
const KEYCLOAK = 'http://keycloak:8080';
const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const MILA = 'c1000000-0000-7000-8000-000000000030';
const run = Date.now().toString(36);
const code = `test-${run}-d`;
const schoolName = `School D ${run}`;
const companyName = `Test company ${run} D`;

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");
const page = async (browser: Browser, path: string) =>
  (await browser.follow(new URL(path, APP).toString())).response.text();
const act = (browser: Browser, fields: Record<string, string>) =>
  browser.request(`${APP}/admin/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });

function nextMonday(): Date {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  return day;
}
const plus = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** Stands in for the new principal choosing their own password at first sign-in. */
async function finishFirstSignIn(username: string, password: string): Promise<void> {
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
  ).json()) as { id: string }[];
  await call(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) });
  await call(`/users/${user!.id}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: password, temporary: false }),
  });
}

describe('a fourth school, from nothing to a working school', () => {
  it('is set up, enrols a child, sells lunch, shows in the kitchen and the reports, and has a live website', async () => {
    // 1. The group administrator sets School D up in the web app.
    const admin = (await signIn('admin@pythagoras.test', PASSWORD)).browser;
    const added = await act(admin, {
      action: 'create-company',
      back: '/admin/schools',
      legal_name: companyName,
      registration_number: String(Date.now()).slice(-9),
    });
    const overview = await page(admin, added.headers.get('location')!);
    const companyId = new RegExp(`<option value="([0-9a-f-]{36})">${companyName}</option>`).exec(
      overview,
    )![1]!;
    const created = await act(admin, {
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
    await act(admin, {
      action: 'add-offering',
      back,
      school_id: schoolId,
      service_definition_id: LUNCH,
      name: `Lunch at ${schoolName}`,
      price: '5.20',
      price_unit: 'per_day',
    });
    let setup = await page(admin, back);
    const offeringId = /<select name="offering_id" required=""><option value="([0-9a-f-]{36})"/.exec(
      setup,
    )![1]!;
    const monday = nextMonday();
    await act(admin, {
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
    const principalEmail = `test-${run}-d-principal@pythagoras.test`;
    await act(admin, {
      action: 'add-staff',
      back,
      school_id: schoolId,
      given_name: 'Dora',
      family_name: 'Principal',
      email: principalEmail,
      role_code: 'principal',
    });
    setup = await page(admin, back);
    const principalId = /data-testid="create-account-([0-9a-f-]{36})"/.exec(setup)![1]!;
    const account = await act(admin, { action: 'create-account', back, person_id: principalId });
    expect(await account.text()).toMatch(/data-testid="temporary-password"[^>]*>[A-Za-z0-9]{24}</);
    await act(admin, { action: 'create-website', back, school_id: schoolId });
    const activated = await act(admin, { action: 'activate', back, school_id: schoolId });
    expect(await page(admin, activated.headers.get('location')!)).toContain('Status: active.');

    // 2. School D's new principal signs in and, on the students page, enrols Anna's third child.
    const principalPassword = `School-D-${run}-Passw0rd`;
    await finishFirstSignIn(principalEmail, principalPassword);
    const principal = (await signIn(principalEmail, principalPassword)).browser;
    const studentsPath = `/schools/${schoolId}/students`;
    expect(await page(principal, '/')).toContain(`href="${studentsPath}"`);
    const studentsAction = (fields: Record<string, string>) =>
      principal.request(`${APP}${studentsPath}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
        body: new URLSearchParams(fields),
      });
    const enrolled = await studentsAction({
      action: 'enrol-student',
      given_name: 'Daria',
      family_name: 'Ivanova',
      academic_year: '2026/2027',
      grade_level: '1',
      class_label: '1D',
      start_date: '2026-09-15',
    });
    let students = await page(principal, enrolled.headers.get('location')!);
    expect(students).toContain('Student enrolled.');
    const studentId = /name="student_id" value="([0-9a-f-]{36})"/.exec(
      students.slice(students.indexOf('data-testid="student-Daria"')),
    )![1]!;
    // Anna already has children at two schools: found by her e-mail, never registered twice.
    const linked = await studentsAction({
      action: 'add-guardian',
      student_id: studentId,
      email: 'anna.ivanova@pythagoras.test',
      relationship: 'mother',
      can_pay: 'on',
      can_manage_bookings: 'on',
    });
    students = await page(principal, linked.headers.get('location')!);
    expect(students).toContain('Guardian recorded and verified.');
    expect(students).toContain('Anna Ivanova, Mother: pays, books');

    // 3. Anna sees three children and buys lunch for Daria (School D) and Mila (School A).
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const home = await page(anna, '/');
    expect(home).toContain(schoolName);
    const services = await page(anna, '/services');
    expect(services).toContain(`Lunch at ${schoolName}`);
    const choices = (services.match(/<input[^>]*type="checkbox"[^>]*name="lunch"[^>]*>/g) ?? [])
      .filter((input) => !/\sdisabled(=""|\s|>|\/)/.test(input))
      .map((input) => decode(/value="([^"]+)"/.exec(input)![1]!));
    const dariaDay = choices.find((value) => value.startsWith(`${studentId}|`))!;
    const milaDay = choices.find((value) => value.startsWith(`${MILA}|`))!;
    expect(dariaDay && milaDay).toBeTruthy();
    const key = /name="idempotency_key" value="([^"]+)"/.exec(services)![1]!;
    const placed = await anna.request(`${APP}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
      body: new URLSearchParams([
        ['idempotency_key', key],
        ['lunch', dariaDay],
        ['lunch', milaDay],
      ]),
    });
    // Two companies, two orders: the portal shows both and offers to pay each.
    const orderUrl = new URL(placed.headers.get('location')!, APP).toString();
    let orders = await page(anna, orderUrl);
    expect(orders).toContain(`Billed by ${companyName}.`);
    expect(orders).toContain('Billed by Testing Company.');
    const payLinks = [...orders.matchAll(/<a href="([^"]+)" data-testid="pay-now">/g)].map((match) =>
      decode(match[1]!),
    );
    expect(payLinks).toHaveLength(2);
    for (const link of payLinks) {
      const provider = await (await anna.follow(link)).response.text();
      const action = decode(/<form method="post" action="([^"]+\/succeed)"/.exec(provider)![1]!);
      await anna.request(new URL(action, link).toString(), { method: 'POST' });
    }
    const deadline = Date.now() + 20_000;
    do {
      await new Promise((resolve) => setTimeout(resolve, 500));
      orders = await page(anna, orderUrl);
    } while ((orders.match(/data-status="paid"/g) ?? []).length < 2 && Date.now() < deadline);
    expect((orders.match(/data-status="paid"/g) ?? []).length).toBe(2);

    // 4. School D's principal sees Daria's lunch in the kitchen counts, and only School D.
    const kitchen = await page(principal, '/school-life/kitchen?days=10');
    const section = kitchen.slice(kitchen.indexOf(`data-testid="kitchen-${schoolName}"`));
    expect(section.length).toBeGreaterThan(0);
    expect(section).toMatch(/data-testid="meals">1</);
    expect(kitchen).not.toContain('data-testid="kitchen-School A"');
    const principalA = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await page(principalA, '/school-life/kitchen?days=10')).not.toContain(schoolName);

    // A teacher sees their school's students but cannot enrol or record guardians.
    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    const teacherList = await page(teacher, '/schools/b1000000-0000-7000-8000-00000000000b/students');
    expect(teacherList).toContain('data-testid="student-Kalina"');
    expect(teacherList).not.toContain('data-testid="enrol-student"');
    expect(teacherList).not.toContain('data-testid="add-guardian-Kalina"');
    expect(await page(teacher, studentsPath)).toContain('data-testid="not-permitted"');

    // 5. The CEO sees School D's (test) money in the revenue report.
    const ceo = (await signIn('ceo@pythagoras.test', PASSWORD)).browser;
    const report = await page(ceo, '/reports/revenue');
    const row = report.slice(report.indexOf(`data-testid="revenue-${schoolName}"`));
    expect(/data-testid="test-net"[^>]*>([^<]*)</.exec(row)![1]).toContain('5,20');

    // 6. School D's website is live on its address.
    const site = await fetch('http://web:3000/', {
      headers: { 'x-forwarded-host': `${code}.pythagoras.localhost:53000` },
    });
    expect(site.status).toBe(200);
    expect(await site.text()).toContain(`Welcome to ${schoolName}.`);
  });
});
