import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Anna buys lunch for both children and a club for one through the web app,
// pays on the development payment provider's page, and sees the order as paid
// only once the worker has confirmed the signed provider event.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const BANNER = 'Payments use the development payment provider: no money moves';

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
