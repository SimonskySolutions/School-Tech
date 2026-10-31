import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Transport through the web app (M4.5): Anna buys Mila a seat on route 1 from
// the second stop and pays; School Life sees her on the driver's list for a
// school day of the term; the principal adds a stop to the route.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const BUS = 'd2000000-0000-7000-8000-0000000000a8';
const STOP_2 = 'd5000000-0000-7000-8000-0000000000a2';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");

async function postForm(browser: Browser, path: string, fields: [string, string][], origin = APP) {
  return browser.request(`${APP}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams(fields),
  });
}

/** A school day inside the seeded term (it starts 14 days after seeding). */
function termDay(): string {
  const day = new Date(Date.now() + 16 * 86_400_000);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

describe('a bus seat for Mila', () => {
  it('lets Anna choose a stop and pay, and shows Mila on the driver’s list', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const services = decode(await (await anna.follow(`${APP}/services`)).response.text());
    expect(services).toContain('School bus, route 1, School A');
    expect(services).toContain(`value="${MILA}|${BUS}|${STOP_2}"`);
    expect(services).toContain('Druzhba park, north gate (synthetic) (pick-up 07:35, back 16:25)');

    const placed = await postForm(anna, '/checkout', [
      ['idempotency_key', crypto.randomUUID()],
      ['transport', `${MILA}|${BUS}|${STOP_2}`],
    ]);
    expect(placed.status).toBe(303);
    const checkoutUrl = placed.headers.get('location')!;
    const provider = await (await anna.follow(checkoutUrl)).response.text();
    const payAction = decode(/<form method="post" action="([^"]+\/succeed)"/.exec(provider)![1]!);
    const paid = await anna.request(new URL(payAction, checkoutUrl).toString(), { method: 'POST' });
    const orderUrl = new URL(paid.headers.get('location')!, APP).toString();
    let order = '';
    for (let tries = 0; tries < 40; tries += 1) {
      order = decode(await (await anna.follow(orderUrl)).response.text());
      if (order.includes('data-status="paid"')) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    expect(order).toContain('School bus, route 1, School A, from Druzhba park, north gate (synthetic)');

    const after = decode(await (await anna.follow(`${APP}/services`)).response.text());
    const bus = after.slice(after.indexOf('data-testid="offering-transport"'));
    expect(bus.slice(0, bus.indexOf('</fieldset>'))).toContain('(booked)');

    const schoolLife = (await signIn('schoollife@pythagoras.test', PASSWORD)).browser;
    const list = decode(
      await (await schoolLife.follow(`${APP}/school-life/transport?from=${termDay()}`)).response.text(),
    );
    const route = list.slice(list.indexOf('data-testid="route-School bus, route 1, School A"'));
    expect(route).toContain('Minibus CA 0000 XX (synthetic)');
    const druzhba = route.slice(route.indexOf('Druzhba park'));
    expect(druzhba.slice(0, druzhba.indexOf('</li></ul>') + 1)).toContain('Mila Ivanova, 3A');
  });
});

describe('routes for staff', () => {
  it('lets the principal see the route and add a stop', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const page = decode(
      await (await principal.follow(`${APP}/schools/${SCHOOL_A}/transport`)).response.text(),
    );
    expect(page).toContain('Transport at School A');
    expect(page).toContain('Mladost metro station (synthetic) · pick-up 07:20 · back 16:40');
    expect(page).toMatch(/Spring term: \d+ \w+ \d{4} to \d+ \w+ \d{4}/);
    const added = await postForm(principal, `/schools/${SCHOOL_A}/transport/actions`, [
      ['action', 'add-stop'],
      ['offering_id', BUS],
      ['name', 'Library corner (e2e test)'],
      ['pickup_time', '07:50'],
    ]);
    expect(added.status).toBe(303);
    const back = decode(
      await (await principal.follow(new URL(added.headers.get('location')!, APP).toString())).response.text(),
    );
    expect(back).toContain('Stop added.');
    expect(back).toContain('Library corner (e2e test) · pick-up 07:50');
  });

  it('keeps a teacher at another school and cross-site forms out', async () => {
    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    const page = await (await teacher.follow(`${APP}/schools/${SCHOOL_A}/transport`)).response.text();
    expect(page).toContain('data-testid="not-permitted"');
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      principal,
      `/schools/${SCHOOL_A}/transport/actions`,
      [
        ['action', 'add-stop'],
        ['offering_id', BUS],
      ],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
  });
});
