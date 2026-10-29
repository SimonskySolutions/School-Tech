import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Anna buys lunch for both children and a club for one through the web app,
// pays on the development payment provider's page, and sees the order as paid
// only once the worker has confirmed the signed provider event.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const BANNER = 'Payments use the development payment provider: no money moves';
/** Anna's order from the first test, for the cancellation at the end. */
let annasOrder = '';

const decode = (value: string) => value.replaceAll('&amp;', '&').replaceAll('&#x27;', "'");

/** Values of the enabled checkboxes with this name, in page order. */
function choices(html: string, name: string): string[] {
  const inputs = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
  return inputs
    .filter((input) => input.includes(`name="${name}"`) && !/\sdisabled(=""|\s|>|\/)/.test(input))
    .map((input) => decode(/value="([^"]+)"/.exec(input)![1]!));
}

async function waitForStatus(browser: Browser, url: string, status: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const page = await browser.follow(url);
    const html = await page.response.text();
    if (html.includes(`data-status="${status}"`)) return html;
    if (Date.now() > deadline) throw new Error(`order never reached ${status}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

describe('buying through the family portal', () => {
  it('Anna books lunch for both children and a club for Mila, then pays', async () => {
    const { browser } = await signIn('anna.ivanova@pythagoras.test', PASSWORD);

    const home = await (await browser.follow(`${APP}/`)).response.text();
    expect(home).toContain('href="/services"');

    const services = await browser.follow(`${APP}/services`);
    expect(services.response.status).toBe(200);
    const form = await services.response.text();
    expect(form).toContain(BANNER);
    expect(form).toContain('Lunch at School A');
    expect(form).toContain('Lunch at School C');
    const key = /name="idempotency_key" value="([^"]+)"/.exec(form)![1]!;

    const lunch = choices(form, 'lunch');
    const milaLunch = lunch.find((value) => value.startsWith('c1000000-0000-7000-8000-000000000030|'))!;
    const borisLunch = lunch.find((value) => value.startsWith('c1000000-0000-7000-8000-000000000031|'))!;
    const club = choices(form, 'activity').find((value) =>
      value.startsWith('c1000000-0000-7000-8000-000000000030|'),
    )!;
    expect([milaLunch, borisLunch, club].every(Boolean)).toBe(true);

    const body = new URLSearchParams([
      ['idempotency_key', key],
      ['lunch', milaLunch],
      ['lunch', borisLunch],
      ['activity', club],
    ]);
    const placed = await browser.request(`${APP}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
      body,
    });
    expect(placed.status).toBe(303);
    const checkoutUrl = placed.headers.get('location')!;
    expect(checkoutUrl).toContain('/dev-payments/checkout/');

    // The provider's page is labelled as development; no card is asked for.
    const providerPage = await browser.follow(checkoutUrl);
    const providerHtml = await providerPage.response.text();
    expect(providerHtml).toContain('No money moves');
    const payAction = decode(/<form method="post" action="([^"]+\/succeed)"/.exec(providerHtml)![1]!);

    const paid = await browser.request(new URL(payAction, checkoutUrl).toString(), { method: 'POST' });
    expect(paid.status).toBe(303);
    const orderUrl = paid.headers.get('location')!;
    annasOrder = orderUrl.split('?')[0]!;
    expect(orderUrl).toMatch(/\/orders\/[0-9a-f-]{36}\?returned=1$/);

    // Straight after the redirect the payment is not confirmed yet.
    const first = await (await browser.follow(orderUrl)).response.text();
    expect(first).toContain(BANNER);
    if (first.includes('data-status="pending_payment"')) {
      expect(first).toContain('Waiting for the payment provider to confirm your payment');
      expect(first).toContain('http-equiv="refresh"');
    }

    const confirmed = await waitForStatus(browser, orderUrl, 'paid');
    expect(confirmed).toContain('Payment confirmed. Your places are booked.');
    expect(confirmed).toContain('Development payment: no money moved.');
    expect(confirmed).toContain('Billed by Testing Company');
    expect(confirmed).not.toContain('data-testid="pay-now"');

    // A second submit of the same form gives the same order, not a second charge.
    const again = await browser.request(`${APP}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
      body,
    });
    expect(again.headers.get('location')).toBe(new URL(orderUrl.split('?')[0]!, APP).toString());

    // The booked days now show as booked.
    const after = await (await browser.follow(`${APP}/services`)).response.text();
    expect(choices(after, 'lunch')).not.toContain(milaLunch);
    expect(choices(after, 'activity')).not.toContain(club);
  });

  it('refuses an order placed from another site', async () => {
    const { browser } = await signIn('anna.ivanova@pythagoras.test', PASSWORD);
    const response = await browser.request(`${APP}/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.test' },
      body: new URLSearchParams([['idempotency_key', crypto.randomUUID()]]),
    });
    expect(response.status).toBe(403);
  });

  it("does not show another family's order", async () => {
    const { browser } = await signIn('hristo.georgiev@pythagoras.test', PASSWORD);
    const page = await browser.follow(`${APP}/orders/01900000-0000-7000-8000-000000000000`);
    expect(page.response.status).toBe(404);
  });
});

// Runs after the purchase above (tests in a file run in order): staff see it.
describe('School Life after the purchase', () => {
  const page = async (user: string, path: string) => {
    const { browser } = await signIn(`${user}@pythagoras.test`, PASSWORD);
    const result = await browser.follow(`${APP}${path}`);
    return { status: result.response.status, html: await result.response.text() };
  };
  const MILA_ALLERGY = 'Mila Ivanova (3A): Allergy (Life-threatening), Peanuts (synthetic example)';
  // The kitchen role may not read enrolments, so it sees the name without the class.
  const MILA_ALLERGY_FOR_KITCHEN = 'Mila Ivanova: Allergy (Life-threatening), Peanuts (synthetic example)';

  it("shows the coordinator every school's lunches, with Mila's allergy as an alert", async () => {
    const home = await page('schoollife', '/');
    expect(home.html).toContain('href="/school-life/kitchen"');
    const kitchen = await page('schoollife', '/school-life/kitchen?days=10');
    expect(kitchen.status).toBe(200);
    expect(kitchen.html).toContain(BANNER);
    for (const school of ['School A', 'School B', 'School C']) {
      expect(kitchen.html).toContain(`data-testid="kitchen-${school}"`);
    }
    const at = kitchen.html.indexOf(MILA_ALLERGY);
    expect(at).toBeGreaterThan(0);
    // Shown as an alert: the list item carrying the text has role="alert".
    expect(kitchen.html.slice(kitchen.html.lastIndexOf('<li', at), at)).toContain('role="alert"');
  });

  it('shows the School A kitchen only School A', async () => {
    const kitchen = await page('kitchen.a', '/school-life/kitchen?days=10');
    expect(kitchen.html).toContain('data-testid="kitchen-School A"');
    expect(kitchen.html).not.toContain('data-testid="kitchen-School C"');
    expect(kitchen.html).toContain(MILA_ALLERGY_FOR_KITCHEN);
  });

  it('shows the CEO the counts without health data', async () => {
    const kitchen = await page('ceo', '/school-life/kitchen?days=10');
    expect(kitchen.html).toContain('Dietary needs are not shown for your role.');
    expect(kitchen.html).not.toContain('Peanuts');
  });

  it('lists Mila on the chess club register', async () => {
    const registers = await page('schoollife', '/school-life/registers');
    expect(registers.html).toContain('Chess club, School A');
    expect(registers.html).toContain('Mila Ivanova, 3A: Booked');
  });

  it('keeps parents out', async () => {
    const kitchen = await page('anna.ivanova', '/school-life/kitchen');
    expect(kitchen.html).toContain('data-testid="not-permitted"');
    expect(kitchen.html).not.toContain('Peanuts');
  });
});

// Runs after the purchase above: the CEO sees it as test money, never as revenue.
describe('CEO reporting after the purchase', () => {
  const page = async (user: string, path: string) => {
    const { browser } = await signIn(`${user}@pythagoras.test`, PASSWORD);
    const result = await browser.follow(`${APP}${path}`);
    return { status: result.response.status, html: await result.response.text() };
  };
  const cellOf = (html: string, school: string, testId: string) => {
    const row = html.slice(html.indexOf(`data-testid="revenue-${school}"`));
    return /data-testid="([a-z-]+)"[^>]*>([^<]*)</.exec(
      row.slice(row.indexOf(`data-testid="${testId}"`)),
    )?.[2];
  };

  it("shows the CEO School A's development payment as test money, with no live revenue", async () => {
    const home = await page('ceo', '/');
    expect(home.html).toContain('href="/reports/revenue"');
    const report = await page('ceo', '/reports/revenue');
    expect(report.status).toBe(200);
    expect(report.html).toContain(BANNER);
    expect(report.html).toContain('Test payments come from the development payment provider');
    for (const school of ['School A', 'School B', 'School C']) {
      expect(report.html).toContain(`data-testid="revenue-${school}"`);
    }
    expect(cellOf(report.html, 'School A', 'test-net')).toMatch(/\d/);
    expect(cellOf(report.html, 'School A', 'live-net')).toBe('–');
  });

  it('shows a principal only their school, and keeps teachers out', async () => {
    const principal = await page('principal.a', '/reports/revenue');
    expect(principal.html).toContain('data-testid="revenue-School A"');
    expect(principal.html).not.toContain('data-testid="revenue-School C"');
    const teacher = await page('teacher.b', '/reports/revenue');
    expect(teacher.html).toContain('data-testid="not-permitted"');
  });

  it('explains a period it cannot use', async () => {
    const report = await page('ceo', '/reports/revenue?from=2026-10-31&to=2026-10-01');
    expect(report.html).toContain('data-testid="period-invalid"');
  });
});

// Runs last: School Life cancels Mila's lunch; Anna sees it and gets credit.
describe('cancelling a lunch day after the purchase', () => {
  it("School Life cancels Mila's lunch from the lunch list; Anna sees it on her order", async () => {
    const { browser } = await signIn('schoollife@pythagoras.test', PASSWORD);
    const kitchen = await (await browser.follow(`${APP}/school-life/kitchen?days=10`)).response.text();
    // The day Mila is booked is the row carrying her allergy alert.
    const at = kitchen.indexOf('Mila Ivanova (3A): Allergy');
    expect(at).toBeGreaterThan(0);
    const href = decode(
      /href="(\/school-life\/lunch\?[^"]+)"/.exec(kitchen.slice(kitchen.lastIndexOf('<tr', at)))![1]!,
    );
    const listUrl = `${APP}${href}`;

    const list = await (await browser.follow(listUrl)).response.text();
    expect(list).toContain(BANNER);
    const row = list.slice(list.indexOf('Mila Ivanova, 3A'));
    const bookingId = /name="booking_id" value="([^"]+)"/.exec(row)![1]!;
    const hidden = (name: string) => decode(new RegExp(`name="${name}" value="([^"]+)"`).exec(row)![1]!);

    const response = await browser.request(`${APP}/school-life/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: APP },
      body: new URLSearchParams({
        booking_id: bookingId,
        school_id: hidden('school_id'),
        date: hidden('date'),
        reason: 'Absent: school trip',
      }),
    });
    expect(response.status).toBe(303);
    const back = await (
      await browser.follow(new URL(response.headers.get('location')!, APP).toString())
    ).response.text();
    expect(back).toContain('Lunch cancelled. The family receives credit for that day');
    expect(back.slice(back.indexOf('data-testid="cancelled-list"'))).toContain('Mila Ivanova, 3A');

    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const order = await (await anna.follow(annasOrder)).response.text();
    expect(order).toContain('their amount is kept as credit');
    expect(order).toContain('Not booked');
  });

  it('refuses a cancellation sent from another site', async () => {
    const { browser } = await signIn('schoollife@pythagoras.test', PASSWORD);
    const response = await browser.request(`${APP}/school-life/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://evil.test' },
      body: new URLSearchParams({ booking_id: crypto.randomUUID(), reason: 'x' }),
    });
    expect(response.status).toBe(403);
  });
});
