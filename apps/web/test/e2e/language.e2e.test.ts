import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP, Browser, signIn } from './browser';

// The EN / BG switch (M9.1, ADR 0039): before signing in the browser decides
// and the switch overrides it; signed in, the choice is the person's own and
// follows them to another browser; a choice made before signing in becomes
// theirs.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();

const page = async (browser: Browser, path = '/', headers: Record<string, string> = {}) =>
  (await (await browser.follow(`${APP}${path}`, { headers })).response.text()).replaceAll('&#x27;', "'");
const choose = (browser: Browser, language: string, back = '/', origin = APP) =>
  browser.request(`${APP}/language`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin },
    body: new URLSearchParams({ language, back }),
  });
const lang = (html: string) => /<html lang="([a-z]+)"/.exec(html)?.[1];

/** Clears a person's saved choice through the API, so each run starts with none. */
async function forget(username: string) {
  const token = await fetch('http://keycloak:8080/realms/pythagoras/protocol/openid-connect/token', {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'pythagoras-dev-tests',
      username,
      password: PASSWORD,
    }),
  });
  const { access_token } = (await token.json()) as { access_token: string };
  const response = await fetch('http://api:3000/me/language', {
    method: 'PUT',
    headers: { authorization: `Bearer ${access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ language: null }),
  });
  expect(response.status).toBe(200);
}

// Hristo and Teodora start and end with no choice of their own, so the other
// suites, which read the English words, see English.
const PEOPLE = ['hristo.georgiev@pythagoras.test', 'teodora.marinova@pythagoras.test'];
beforeAll(async () => {
  for (const person of PEOPLE) await forget(person);
});
afterAll(async () => {
  for (const person of PEOPLE) await forget(person);
});

describe('language', () => {
  it('is English unless the browser asks for Bulgarian, before signing in', async () => {
    const plain = await page(new Browser());
    expect(lang(plain)).toBe('en');
    expect(plain).toContain('data-testid="sign-in"');
    expect(plain).toContain('>Sign in<');
    const asked = await page(new Browser(), '/', { 'accept-language': 'bg-BG,bg;q=0.9,en;q=0.5' });
    expect(lang(asked)).toBe('bg');
    expect(asked).toContain('>Вход<');
    expect(asked).toContain('aria-pressed="true" data-testid="language-bg"');
  });

  it('switches with EN / BG and comes back to the same page', async () => {
    const browser = new Browser();
    const switched = await choose(browser, 'bg', '/not-linked');
    expect(switched.status).toBe(303);
    expect(switched.headers.get('location')).toBe(`${APP}/not-linked`);
    expect(browser.cookies.get('pythagoras_language')?.value).toBe('bg');
    expect(await page(browser, '/not-linked')).toContain('Този вход не е свързан');
    await choose(browser, 'en');
    expect(await page(browser)).toContain('>Sign in<');
  });

  it('refuses another site’s form, an unknown language and a way out of the portal', async () => {
    const browser = new Browser();
    expect((await choose(browser, 'bg', '/', 'http://evil.example')).status).toBe(403);
    await choose(browser, 'de');
    expect(browser.cookies.has('pythagoras_language')).toBe(false);
    const away = await choose(browser, 'bg', '//evil.example/');
    expect(away.headers.get('location')).toBe(`${APP}/`);
  });

  it('is the signed-in person’s own, and follows them to another browser', async () => {
    const first = (await signIn('hristo.georgiev@pythagoras.test', PASSWORD)).browser;
    await choose(first, 'en');
    const english = await page(first);
    expect(lang(english)).toBe('en');
    expect(english).toContain('Sign out');
    expect(english).toContain('Hello, Hristo');

    await choose(first, 'bg');
    const bulgarian = await page(first);
    expect(lang(bulgarian)).toBe('bg');
    expect(bulgarian).toContain('Изход');
    expect(bulgarian).toContain('Здравейте, Hristo');
    expect(bulgarian).toContain('Общ преглед');
    expect(bulgarian).toContain('Вашите деца');

    // Another browser that asks for English: the saved choice wins once signed in.
    const second = new Browser();
    await signIn('hristo.georgiev@pythagoras.test', PASSWORD, undefined, second);
    expect(lang(await page(second, '/', { 'accept-language': 'en' }))).toBe('bg');
    expect(second.cookies.get('pythagoras_language')?.value).toBe('bg');
  });

  it('keeps a choice made before signing in', async () => {
    const browser = new Browser();
    await choose(browser, 'bg');
    await signIn('teodora.marinova@pythagoras.test', PASSWORD, undefined, browser);
    // A fresh browser, without the cookie: the choice is now Teodora's own.
    const elsewhere = (await signIn('teodora.marinova@pythagoras.test', PASSWORD)).browser;
    expect(lang(await page(elsewhere))).toBe('bg');
  });
});
