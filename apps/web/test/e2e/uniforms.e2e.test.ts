import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP, type Browser, signIn } from './browser';

// Uniforms through the web app (M4.6): Anna buys two size-128 polo shirts for
// Mila and pays; the principal sees them waiting, hands them over and takes in
// a delivery of the sold-out size.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const MILA = 'c1000000-0000-7000-8000-000000000030';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const POLO = 'd2000000-0000-7000-8000-0000000000a9';
const SIZE_128 = 'd6000000-0000-7000-8000-0000000000a2';
const SIZE_152 = 'd6000000-0000-7000-8000-0000000000a4';

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

const row = (page: string, testId: string) => {
  const start = page.indexOf(`data-testid="${testId}"`);
  return page.slice(start, page.indexOf('</tr>', start));
};

describe('uniforms for Mila', () => {
  it('lets Anna buy two shirts and the principal hand them over', async () => {
    const anna = (await signIn('anna.ivanova@pythagoras.test', PASSWORD)).browser;
    const services = decode(await (await anna.follow(`${APP}/services`)).response.text());
    const mila = services.slice(services.indexOf('data-testid="child-Mila"'));
    expect(mila).toContain('School polo shirt, School A');
    expect(mila).toMatch(/140, Navy · 25,00\s?€ · 1 left/);
    expect(mila).toMatch(/152, Navy · 28,00\s?€ · sold out/);

    const placed = await postForm(anna, '/checkout', [
      ['idempotency_key', crypto.randomUUID()],
      ['uniform', `${MILA}|${POLO}|${SIZE_128}|2`],
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
    expect(order).toContain('School polo shirt, School A, 128, Navy');
    expect(order).toMatch(/Total 50,00\s?€/);

    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const page = decode(
      await (await principal.follow(`${APP}/schools/${SCHOOL_A}/uniforms`)).response.text(),
    );
    expect(page).toContain('Uniforms at School A');
    const waiting = page.slice(page.indexOf('data-testid="awaiting-handover"'));
    expect(waiting).toContain('Mila Ivanova, 3A: 2 × School polo shirt, School A, 128');
    const reservationId = /name="reservation_id" value="([^"]+)"/.exec(waiting)![1]!;
    expect(row(page, 'variant-POLO-NAVY-128')).toMatch(/>10<\/td>.*>0<\/td>.*>2<\/td>.*>8<\/td>/s);

    const handed = await followBack(
      principal,
      await postForm(principal, `/schools/${SCHOOL_A}/uniforms/actions`, [
        ['action', 'hand-over'],
        ['reservation_id', reservationId],
      ]),
    );
    expect(handed).toContain('Handed over.');
    expect(row(handed, 'variant-POLO-NAVY-128')).toMatch(/>8<\/td>.*>0<\/td>.*>0<\/td>.*>8<\/td>/s);
    expect(handed.slice(handed.indexOf('data-testid="low-stock"'))).toContain(
      'School polo shirt, School A, 140: 1 free',
    );
  });

  it('lets the principal take in a delivery of the sold-out size', async () => {
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const delivered = await followBack(
      principal,
      await postForm(principal, `/schools/${SCHOOL_A}/uniforms/actions`, [
        ['action', 'stock'],
        ['variant_id', SIZE_152],
        ['kind', 'delivery'],
        ['delta', '5'],
        ['reason', 'Delivery note 1 (e2e test)'],
      ]),
    );
    expect(delivered).toContain('Stock changed.');
    expect(row(delivered, 'variant-POLO-NAVY-152')).toMatch(/>5<\/td>.*>0<\/td>.*>0<\/td>.*>5<\/td>/s);
    const refused = await postForm(principal, `/schools/${SCHOOL_A}/uniforms/actions`, [
      ['action', 'stock'],
      ['variant_id', SIZE_152],
      ['kind', 'delivery'],
      ['delta', '-1'],
      ['reason', 'x'],
    ]);
    expect(new URL(refused.headers.get('location')!, APP).searchParams.get('error')).toBe(
      'a delivery adds items; use a correction to remove',
    );
  });

  it('keeps a teacher at another school and cross-site forms out', async () => {
    const teacher = (await signIn('teacher.b@pythagoras.test', PASSWORD)).browser;
    const page = await (await teacher.follow(`${APP}/schools/${SCHOOL_A}/uniforms`)).response.text();
    expect(page).toContain('data-testid="not-permitted"');
    const principal = (await signIn('principal.a@pythagoras.test', PASSWORD)).browser;
    const evil = await postForm(
      principal,
      `/schools/${SCHOOL_A}/uniforms/actions`,
      [['action', 'stock']],
      'http://evil.test',
    );
    expect(evil.status).toBe(403);
  });
});
