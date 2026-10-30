import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// The group administrator sets up a school through the web pages (M3.4):
// company, draft school, lunch with a price, a calendar, a principal with a
// sign-in account, activation. Test schools use the "test-" prefix; the e2e
// script removes them before each run (scripts/db-reset-test-data.sh).

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const run = Date.now().toString(36);

function nextMonday(): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  return day.toISOString().slice(0, 10);
}

async function act(browser: Browser, fields: Record<string, string>) {
  return browser.request(`${APP}/admin/actions`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
    body: new URLSearchParams(fields),
  });
}

/** Whether the "Activate" button is disabled, whatever order React writes its attributes in. */
const activateDisabled = (html: string) =>
  /\sdisabled(=""|\s|>)/.test(/<button[^>]*data-testid="activate"[^>]*>/.exec(html)![0]);

const page = async (browser: Browser, path: string) =>
  (await browser.follow(new URL(path, APP).toString())).response.text();

describe('setting up a school in the web app', () => {
  it('takes the administrator from a new company to a live school', async () => {
    const { browser } = await signIn('admin@pythagoras.test', PASSWORD);
    expect(await page(browser, '/')).toContain('href="/admin/schools"');

    // A billing company.
    const company = `Test company ${run} web`;
    const added = await act(browser, {
      action: 'create-company',
      back: '/admin/schools',
      legal_name: company,
      registration_number: String(Date.now()).slice(-9),
    });
    expect(added.status).toBe(303);
    const overview = await page(browser, added.headers.get('location')!);
    expect(overview).toContain('Company added.');
    const companyId = new RegExp(`<option value="([0-9a-f-]{36})">${company}</option>`).exec(overview)![1]!;

    // A draft school opens on its own set-up page.
    const created = await act(browser, {
      action: 'create-school',
      back: '/admin/schools',
      name: `School W ${run}`,
      code: `test-${run}-web`,
      kind: 'school',
      time_zone: 'Europe/Sofia',
      billing_entity_id: companyId,
    });
    const schoolPath = created.headers.get('location')!;
    expect(schoolPath).toMatch(/\/admin\/schools\/[0-9a-f-]{36}\?done=create-school$/);
    const schoolId = /\/admin\/schools\/([0-9a-f-]{36})/.exec(schoolPath)![1]!;
    const back = `/admin/schools/${schoolId}`;
    let setup = await page(browser, schoolPath);
    expect(setup).toContain(
      `Status: draft. Code test-${run}-web, time zone Europe/Sofia, billed by ${company}.`,
    );
    expect(activateDisabled(setup)).toBe(true);

    // A price that is not an amount comes back as a clear message, and nothing is added.
    const wrong = await act(browser, {
      action: 'add-offering',
      back,
      school_id: schoolId,
      service_definition_id: LUNCH,
      name: 'Lunch',
      price: 'five',
      price_unit: 'per_day',
    });
    expect(await page(browser, wrong.headers.get('location')!)).toContain('is not an amount');

    await act(browser, {
      action: 'add-offering',
      back,
      school_id: schoolId,
      service_definition_id: LUNCH,
      name: `Lunch at School W ${run}`,
      price: '5,20',
      price_unit: 'per_day',
    });
    setup = await page(browser, back);
    const offeringId = /<select name="offering_id" required=""><option value="([0-9a-f-]{36})"/.exec(
      setup,
    )![1]!;
    expect(setup).toMatch(new RegExp(`Lunch at School W ${run}: 5,20.€ per day; 0 sessions`));

    const monday = nextMonday();
    const sessions = await act(browser, {
      action: 'add-sessions',
      back,
      school_id: schoolId,
      offering_id: offeringId,
      pattern: 'school_days',
      from: monday,
      to: monday,
      capacity: '60',
      closed: '',
    });
    expect(await page(browser, sessions.headers.get('location')!)).toContain('Calendar added.');

    const email = `test-${run}-web-principal@pythagoras.test`;
    await act(browser, {
      action: 'add-staff',
      back,
      school_id: schoolId,
      given_name: 'Vera',
      family_name: 'Principal',
      email,
      role_code: 'principal',
    });
    setup = await page(browser, back);
    expect(setup).toContain(`Vera Principal (Principal, ${email}): `);
    const personId = /data-testid="create-account-([0-9a-f-]{36})"/.exec(setup)![1]!;

    // The temporary password is shown once, on the answer to the form itself.
    const account = await act(browser, { action: 'create-account', back, person_id: personId });
    expect(account.status).toBe(200);
    expect(account.headers.get('cache-control')).toBe('no-store');
    const accountHtml = await account.text();
    expect(accountHtml).toContain(email);
    const password = /data-testid="temporary-password"[^>]*>([A-Za-z0-9]{24})</.exec(accountHtml)![1]!;
    expect(account.headers.get('location')).toBeNull();
    setup = await page(browser, back);
    expect(setup).toContain('Vera Principal (Principal, ' + email + '): can sign in');
    expect(setup).not.toContain(password);

    // Ready: activate.
    expect(activateDisabled(setup)).toBe(false);
    const activated = await act(browser, { action: 'activate', back, school_id: schoolId });
    const live = await page(browser, activated.headers.get('location')!);
    expect(live).toContain('The school is live');
    expect(live).toContain('Status: active.');
  });

  it('keeps principals out and refuses forms from other sites', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    expect(await page(principal, '/admin/schools')).toContain('data-testid="not-permitted"');
    const admin = (await signIn('admin@pythagoras.test', PASSWORD)).browser;
    const forged = await admin.request(`${APP}/admin/actions`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.test' },
      body: new URLSearchParams({ action: 'create-company', legal_name: 'Evil', registration_number: '1' }),
    });
    expect(forged.status).toBe(403);
  });
});
