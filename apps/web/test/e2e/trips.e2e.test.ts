import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Trips and consent through the web app (M4.4): Anna reads the museum visit's
// wording, gives permission for Mila, books and pays; School Life sees Mila on
// the participant list with the permission, the contact and her allergy; Anna
// withdraws and the place is cancelled.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const MUSEUM = 'd2000000-0000-7000-8000-0000000000a7';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");

async function postForm(browser: Browser, path: string, fields: [string, string][], origin = APP) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
}

async function followBack(browser: Browser, response: Response): Promise<string> {
  expect(response.status).toBe(303);
  return decode(
    await (await browser.follow(new URL(response.headers.get('location')!, APP).toString())).response.text(),
  );
}

const tripCheckbox = (page: string) => {
  const at = page.indexOf(`value="${MILA}|${MUSEUM}"`);
  expect(at).toBeGreaterThan(-1);
  return page.slice(page.lastIndexOf('<input', at), page.indexOf('>', at) + 1);
};

describe('a trip for Mila', () => {
  it('needs permission, then books, lists and withdraws', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const before = decode(await (await anna.follow(`${APP}/services`)).response.text());
    expect(tripCheckbox(before)).toContain('name="trip"');
    expect(tripCheckbox(before)).toContain('disabled');
    expect(before).toContain('data-testid="permission-needed"');

    const tripsPage = decode(await (await anna.follow(`${APP}/children/${MILA}/trips`)).response.text());
    expect(tripsPage).toContain('Trips: Mila Ivanova');
    expect(tripsPage).toContain('I give permission for my child to take part in the museum visit');
    const sessionId = /name="session_id" value="([^"]+)"/.exec(tripsPage)![1]!;
    const policyVersionId = /name="policy_version_id" value="([^"]+)"/.exec(tripsPage)![1]!;
    const give = (agree: string) =>
      postForm(anna, `/children/${MILA}/trips/actions`, [
        ['action', 'give'],
        ['session_id', sessionId],
        ['policy_version_id', policyVersionId],
        ['contact_name', 'Grandma Ivanova (e2e test)'],
        ['contact_phone', '+359 88 123 4567'],
        ['agree', agree],
      ]);
    expect(new URL((await give('')).headers.get('location')!, APP).searchParams.get('error')).toBe(
      'tick that you have read the wording and give permission',
    );
    const given = await followBack(anna, await give('yes'));
    expect(given).toContain('Permission given. You can now book the place.');
    expect(given).toContain(
      'Permission given here by you. Emergency contact: Grandma Ivanova (e2e test), +359 88 123 4567.',
    );

    const after = decode(await (await anna.follow(`${APP}/services`)).response.text());
    expect(tripCheckbox(after)).not.toMatch(/disabled/);

    const placed = await postForm(anna, '/checkout', [
      ['idempotency_key', crypto.randomUUID()],
      ['trip', `${MILA}|${MUSEUM}`],
    ]);
    const checkoutUrl = placed.headers.get('location')!;
    const provider = await (await anna.follow(checkoutUrl)).response.text();
    const payAction = decode(/<form method="post" action="([^"]+\/succeed)"/.exec(provider)![1]!);
    const paid = await anna.request(new URL(payAction, checkoutUrl).toString(), { method: 'POST' });
    const orderUrl = new URL(paid.headers.get('location')!, APP).toString();
    for (let tries = 0; tries < 40; tries += 1) {
      if ((await (await anna.follow(orderUrl)).response.text()).includes('data-status="paid"')) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const booked = decode(await (await anna.follow(`${APP}/children/${MILA}/trips`)).response.text());
    expect(booked).toContain('data-testid="booking">Booked.');
    expect(booked).toContain('Withdraw permission (cancels the place; what you paid becomes credit)');

    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    const list = decode(await (await schoolLife.follow(`${APP}/school-life/trips`)).response.text());
    const trip = list.slice(list.indexOf('data-testid="trip-Museum visit, School A"'));
    expect(trip).toContain('Mila Ivanova, 3A');
    expect(trip).toContain('Given online by Anna Ivanova');
    expect(trip).toContain('Grandma Ivanova (e2e test), +359 88 123 4567');
    expect(trip).toContain('Allergy (Life-threatening): Peanuts (synthetic example)');

    const permissionId = /name="permission_id" value="([^"]+)"/.exec(booked)![1]!;
    const withdrawn = await followBack(
      anna,
      await postForm(anna, `/children/${MILA}/trips/actions`, [
        ['action', 'withdraw'],
        ['permission_id', permissionId],
      ]),
    );
    expect(withdrawn).toContain('Permission withdrawn and the place cancelled.');
    expect(withdrawn).toContain('data-testid="give-permission"');
  });

  it('shows the administrator the consent wording on the set-up page', async () => {
    const admin = (await signIn('admin@pythagoras.test', PASSWORD)).browser;
    const page = decode(await (await admin.follow(`${APP}/admin/schools/${SCHOOL_A}`)).response.text());
    expect(page).toMatch(/Consent wording \(version \d+\)/);
    expect(page).toContain('One day (trips)');
  });

  it('keeps other parents out and refuses forms from another site', async () => {
    const hristo = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    const refused = await (await hristo.follow(`${APP}/children/${MILA}/trips`)).response.text();
    expect(refused).toContain('data-testid="not-permitted"');
    const parentList = await (await hristo.follow(`${APP}/school-life/trips`)).response.text();
    expect(parentList).toContain('data-testid="not-permitted"');
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      anna,
      `/children/${MILA}/trips/actions`,
      [['action', 'give']],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
  });
});
