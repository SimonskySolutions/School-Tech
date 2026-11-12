import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Browser } from './browser';

// Website editors sign in to the CMS with their Pythagoras (Keycloak)
// account (ADR 0019), through the real Keycloak login form. Keycloak's client
// roles decide who is an editor; the CMS then gives a normal Payload session.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const CMS = 'http://cms.pythagoras.localhost:53000';

async function signInToCms(username: string) {
  const browser = new Browser();
  const login = await browser.follow(`${CMS}/sso/login`);
  const html = await login.response.text();
  const action = /id="kc-form-login"[^>]*\saction="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&');
  if (!action) throw new Error(`no Keycloak login form at ${login.url}`);
  const result = await browser.follow(action, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password: PASSWORD, credentialId: '' }),
  });
  return { browser, status: result.response.status, html: await result.response.text() };
}

// Browsers send this on every request; Payload accepts its cookie only when
// the request comes from the CMS itself (CSRF protection).
const sameSite = { 'sec-fetch-site': 'same-origin' };

const me = async (browser: Browser) =>
  (
    (await (await browser.request(`${CMS}/api/users/me`, { headers: sameSite })).json()) as {
      user: { email: string; role: string } | null;
    }
  ).user;

describe('CMS sign-in with Keycloak', () => {
  it('offers the Pythagoras sign-in on the CMS login page', async () => {
    const html = await (await new Browser().follow(`${CMS}/admin/login`)).response.text();
    // The login page is rendered by Payload's admin; the button travels in its page data.
    expect(html).toContain('/sso/login');
    expect(html).toContain('Sign in with your Pythagoras account');
  });

  it('accepts the session only from the CMS itself, not from another site', async () => {
    const { browser } = await signInToCms('admin@pythagoras.test');
    const crossSite = await browser.request(`${CMS}/api/users/me`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(((await crossSite.json()) as { user: unknown }).user).toBeNull();
  });

  it('signs a CMS administrator in with a Payload session, and out again', async () => {
    const { browser, status, html } = await signInToCms('admin@pythagoras.test');
    expect(status).toBe(200);
    expect(html).toContain('data-testid="signed-in"');
    expect(html).toContain('http-equiv="refresh" content="0;url=/admin"');
    expect(browser.cookies.has('payload-token')).toBe(true);
    expect(browser.cookies.get('payload-token')!.attributes).toMatch(/HttpOnly/i);
    expect(browser.cookies.get('payload-token')!.attributes).toMatch(/SameSite=Strict/i);
    expect(await me(browser)).toMatchObject({ email: 'admin@pythagoras.test', role: 'admin' });

    await browser.request(`${CMS}/api/users/logout`, {
      method: 'POST',
      headers: { origin: CMS, ...sameSite },
    });
    expect(await me(browser)).toBeNull();
  });

  it("takes an editor's role from Keycloak", async () => {
    const { browser } = await signInToCms('schoollife@pythagoras.test');
    expect(await me(browser)).toMatchObject({ email: 'schoollife@pythagoras.test', role: 'editor' });
  });

  it('refuses a Pythagoras account without a CMS role, and creates nothing', async () => {
    const { browser, status, html } = await signInToCms('anna.ivanova@pythagoras.test');
    expect(status).toBe(403);
    expect(html).toContain('data-testid="not-an-editor"');
    expect(browser.cookies.has('payload-token')).toBe(false);
  });

  it('refuses a callback that did not start here', async () => {
    const response = await new Browser().request(`${CMS}/sso/callback?code=forged&state=forged`);
    expect(response.status).toBe(400);
  });
});
