import { readFileSync } from 'node:fs';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { describe, expect, it } from 'vitest';
import { APP, Browser, signIn } from './browser';

// End to end through the running stack: web app, Keycloak, API, PostgreSQL.
// Synthetic development users only.

const PASSWORD = readFileSync('/workspace/secrets/keycloak_dev_user_password', 'utf8').trim();
const SESSION_KEY = Uint8Array.from(
  readFileSync('/workspace/secrets/web_session_secret', 'utf8')
    .trim()
    .match(/../g)!
    .map((byte) => parseInt(byte, 16)),
);
const JWT_IN_PAGE = /eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/;
const user = (name: string) => `${name}@pythagoras.test`;

async function readSession(sealed: string) {
  const { payload } = await jwtDecrypt(sealed, SESSION_KEY);
  return payload as {
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: number;
    refreshExpiresAt: number;
  };
}

/** Re-seals a session as if its access token were about to expire. */
async function nearlyExpired(sealed: string): Promise<string> {
  const session = await readSession(sealed);
  const now = Math.floor(Date.now() / 1000);
  return new EncryptJWT({ ...session, purpose: 'session', accessExpiresAt: now + 20 })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(session.refreshExpiresAt)
    .encrypt(SESSION_KEY);
}

describe('signed out', () => {
  it('shows the start page with a sign-in link', async () => {
    const html = await (await new Browser().request(`${APP}/`)).text();
    expect(html).toContain('Sign in');
    expect(html).toContain('Development build with synthetic data');
  });

  it('starts sign-in with PKCE and a short-lived, HttpOnly transaction cookie', async () => {
    const browser = new Browser();
    const response = await browser.request(`${APP}/auth/sign-in`);
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin + location.pathname).toBe(
      'http://localhost:58080/realms/pythagoras/protocol/openid-connect/auth',
    );
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('client_id')).toBe('pythagoras-web');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    const cookie = browser.cookies.get('pyth_sign_in')!;
    expect(cookie.attributes).toMatch(/HttpOnly/i);
    expect(cookie.attributes).toMatch(/SameSite=lax/i);
    expect(cookie.attributes).toMatch(/Max-Age=600/i);
  });

  it('refuses a callback without a sign-in in progress', async () => {
    const response = await new Browser().request(`${APP}/auth/callback?code=forged&state=forged`);
    expect(response.headers.get('location')).toBe(`${APP}/?error=sign-in-expired`);
  });

  it('refuses a callback whose state does not match', async () => {
    const browser = new Browser();
    await browser.request(`${APP}/auth/sign-in`);
    const response = await browser.request(`${APP}/auth/callback?code=forged&state=not-the-real-state`);
    expect(response.headers.get('location')).toBe(`${APP}/?error=sign-in-failed`);
    expect(browser.cookies.has('pyth_session')).toBe(false);
  });
});

describe('signed in', () => {
  it('a parent sees exactly her two children at two schools', async () => {
    const { browser, url, html } = await signIn(user('anna.ivanova'), PASSWORD);
    expect(url).toBe(`${APP}/`);
    expect(html).toContain('Hello, Anna');
    expect(html).toContain('Your children');
    expect(html).toMatch(/Mila Ivanova.*School A, class 3A/s);
    expect(html).toMatch(/Boris Ivanov.*School C, class 1B/s);
    expect(html).not.toContain('Kalina');
    expect(html).not.toMatch(JWT_IN_PAGE);

    const cookie = browser.cookies.get('pyth_session')!;
    expect(cookie.attributes).toMatch(/HttpOnly/i);
    expect(cookie.attributes).toMatch(/SameSite=lax/i);
    expect(cookie.attributes).toMatch(/Path=\//i);
    expect(cookie.value.split('.')).toHaveLength(5);
    expect(JSON.parse(Buffer.from(cookie.value.split('.')[0]!, 'base64url').toString())).toEqual({
      alg: 'dir',
      enc: 'A256GCM',
    });
    expect(browser.cookies.has('pyth_sign_in')).toBe(false);
  });

  it('the principal of School A sees their school role', async () => {
    const { html } = await signIn(user('principal.a'), PASSWORD);
    expect(html).toContain('Principal at School A');
    expect(html).not.toContain('Your children');
  });

  it('the CEO sees the whole group', async () => {
    const { html } = await signIn(user('ceo'), PASSWORD);
    expect(html).toContain('Across the group');
    expect(html).toMatch(/CEO.*all schools/s);
    for (const school of ['School A', 'School B', 'School C']) expect(html).toContain(school);
  });

  it('a parent whose link is not verified yet is told so', async () => {
    const { html } = await signIn(user('teodora.marinova'), PASSWORD);
    expect(html).toContain('no children or roles linked yet');
  });

  it('a Keycloak account with no Pythagoras person gets no session', async () => {
    const { browser, url } = await signIn(user('unlinked'), PASSWORD);
    expect(url).toBe(`${APP}/not-linked`);
    expect(browser.cookies.has('pyth_session')).toBe(false);
  });

  it('ignores a sign-in return address on another site', async () => {
    const { url } = await signIn(user('hristo.georgiev'), PASSWORD, 'https://evil.example.test/steal');
    expect(url).toBe(`${APP}/`);
  });
});

describe('session lifetime', () => {
  it('refreshes an access token that is about to expire, transparently', async () => {
    const { browser } = await signIn(user('anna.ivanova'), PASSWORD);
    const original = await readSession(browser.cookies.get('pyth_session')!.value);
    browser.setCookie('pyth_session', await nearlyExpired(browser.cookies.get('pyth_session')!.value));

    const html = await (await browser.request(`${APP}/`)).text();
    expect(html).toContain('Mila Ivanova');
    const refreshed = await readSession(browser.cookies.get('pyth_session')!.value);
    expect(refreshed.accessToken).not.toBe(original.accessToken);
    expect(refreshed.accessExpiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000) + 200);
  });

  it('signs out: ends the Keycloak session and deletes the cookie', async () => {
    const { browser } = await signIn(user('anna.ivanova'), PASSWORD);
    const stolenCopy = browser.cookies.get('pyth_session')!.value;

    const forged = await browser.request(`${APP}/auth/sign-out`, {
      method: 'POST',
      headers: { origin: 'https://evil.example.test' },
    });
    expect(forged.status).toBe(403);

    const response = await browser.request(`${APP}/auth/sign-out`, {
      method: 'POST',
      headers: { origin: APP },
    });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${APP}/?signed-out=1`);
    expect(browser.cookies.has('pyth_session')).toBe(false);
    const html = await (await browser.request(`${APP}/?signed-out=1`)).text();
    expect(html).toContain('You have signed out.');

    // Keycloak forgot the session: signing in again shows the login form, not an automatic return.
    const again = await browser.request(`${APP}/auth/sign-in`);
    const keycloak = await browser.request(again.headers.get('location')!);
    expect(keycloak.status).toBe(200);
    expect(await keycloak.text()).toContain('kc-form-login');

    // A copy of the old cookie can no longer be refreshed: it is dropped.
    const replay = new Browser();
    replay.setCookie('pyth_session', await nearlyExpired(stolenCopy));
    const replayHtml = await (await replay.request(`${APP}/`)).text();
    expect(replayHtml).toContain('Sign in');
    expect(replay.cookies.has('pyth_session')).toBe(false);
  });
});
