import { describe, expect, it } from 'vitest';
import {
  cookieOptions,
  keyFromSecret,
  safeReturnTo,
  sealSession,
  sealSignIn,
  type Session,
  unsealSession,
  unsealSignIn,
} from './session';

const KEY = keyFromSecret('0'.repeat(63) + '1');
const OTHER_KEY = keyFromSecret('f'.repeat(64));
const now = Math.floor(Date.now() / 1000);

const session: Session = {
  subject: 'f1000000-0000-7000-8000-000000000020',
  accessToken: 'header.payload.signature',
  refreshToken: 'refresh-token-value',
  accessExpiresAt: now + 300,
  refreshExpiresAt: now + 1800,
};

describe('session cookie', () => {
  it('round-trips through encryption', async () => {
    expect(await unsealSession(await sealSession(session, KEY), KEY)).toEqual(session);
  });

  it('is encrypted: the token cannot be read from the cookie', async () => {
    const sealed = await sealSession(session, KEY);
    expect(sealed.split('.')).toHaveLength(5); // JWE compact form, not a readable JWT
    expect(sealed).not.toContain('refresh-token-value');
    const header = JSON.parse(Buffer.from(sealed.split('.')[0]!, 'base64url').toString()) as Record<
      string,
      string
    >;
    expect(header).toEqual({ alg: 'dir', enc: 'A256GCM' });
  });

  it('rejects a cookie sealed with another key', async () => {
    expect(await unsealSession(await sealSession(session, OTHER_KEY), KEY)).toBeNull();
  });

  it('rejects a tampered cookie', async () => {
    const sealed = await sealSession(session, KEY);
    const parts = sealed.split('.');
    parts[3] = `${parts[3]!.slice(0, -2)}AA`;
    expect(await unsealSession(parts.join('.'), KEY)).toBeNull();
  });

  it('rejects a session whose refresh period has ended', async () => {
    const expired = { ...session, accessExpiresAt: now - 400, refreshExpiresAt: now - 10 };
    expect(await unsealSession(await sealSession(expired, KEY), KEY)).toBeNull();
  });

  it('never accepts a sign-in transaction as a session, or the reverse', async () => {
    const signIn = await sealSignIn(
      { state: 's'.repeat(43), nonce: 'n'.repeat(43), codeVerifier: 'v'.repeat(43), returnTo: '/' },
      KEY,
    );
    expect(await unsealSession(signIn, KEY)).toBeNull();
    expect(await unsealSignIn(await sealSession(session, KEY), KEY)).toBeNull();
    expect(await unsealSignIn(signIn, KEY)).not.toBeNull();
  });

  it('treats a missing or garbage cookie as no session', async () => {
    expect(await unsealSession(undefined, KEY)).toBeNull();
    expect(await unsealSession('garbage', KEY)).toBeNull();
  });
});

describe('cookie options', () => {
  it('are HttpOnly, SameSite=Lax and site-wide; Secure follows HTTPS', () => {
    expect(cookieOptions(true, 1800)).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: true,
      maxAge: 1800,
    });
    expect(cookieOptions(false, -5).maxAge).toBe(0);
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/', '/'],
    ['/children?tab=lunch', '/children?tab=lunch'],
    [null, '/'],
    ['https://evil.example.test/', '/'],
    ['//evil.example.test/path', '/'],
    ['/\\evil.example.test', '/'],
    ['javascript:alert(1)', '/'],
    ['relative/path', '/'],
  ])('%j becomes %j', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected);
  });
});
