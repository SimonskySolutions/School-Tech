import { SignJWT } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestIssuer, TEST_AUDIENCE, TEST_ISSUER } from './test-keys';
import { TokenVerifier } from './token-verifier';

describe('TokenVerifier', () => {
  let issuer: Awaited<ReturnType<typeof createTestIssuer>>;
  let verifier: TokenVerifier;

  beforeAll(async () => {
    issuer = await createTestIssuer();
    verifier = new TokenVerifier({
      issuer: TEST_ISSUER,
      audience: TEST_AUDIENCE,
      allowedClients: ['pythagoras-web'],
      keys: issuer.keys,
    });
  });

  it('accepts a current access token for the API from an allowed client', async () => {
    const verified = await verifier.verify(await issuer.sign());
    expect(verified.subject).toBe('f1000000-0000-7000-8000-000000000020');
    expect(verified.clientId).toBe('pythagoras-web');
    expect(verified.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it.each([
    ['a different issuer', { iss: 'http://evil.example.test/realms/pythagoras' }, 'claim "iss"'],
    ['a different audience', { aud: 'some-other-api' }, 'claim "aud"'],
    ['an ID token', { typ: 'ID' }, 'not an access token'],
    ['a client that may not call the API', { azp: 'pythagoras-dev-tests' }, 'client that may not call'],
  ])('rejects a token with %s', async (_name, claims, reason) => {
    await expect(verifier.verify(await issuer.sign(claims))).rejects.toThrow(reason);
  });

  it('rejects an expired token', async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - 600;
    const token = await issuer.sign({}, { issuedAt, expires: issuedAt + 300 });
    await expect(verifier.verify(token)).rejects.toThrow('expired');
  });

  it('rejects a token signed by another key under our key id', async () => {
    await expect(verifier.verify(await issuer.sign({}, { key: issuer.otherPrivateKey }))).rejects.toThrow(
      'bad signature',
    );
  });

  it('rejects a token signed with an unknown key id', async () => {
    await expect(verifier.verify(await issuer.sign({}, { kid: 'rotated-away' }))).rejects.toThrow(
      'unknown signing key',
    );
  });

  it('rejects a symmetric (HS256) token, even with a plausible payload', async () => {
    const token = await new SignJWT({ typ: 'Bearer', azp: 'pythagoras-web', sub: 'x' })
      .setProtectedHeader({ alg: 'HS256', kid: 'test-key' })
      .setIssuer(TEST_ISSUER)
      .setAudience(TEST_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-an-attacker-might-guess'));
    await expect(verifier.verify(token)).rejects.toThrow(/algorithm not allowed|unknown signing key/);
  });

  it('rejects an unsigned token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        iss: TEST_ISSUER,
        aud: TEST_AUDIENCE,
        sub: 'x',
        typ: 'Bearer',
        azp: 'pythagoras-web',
      }),
    ).toString('base64url');
    await expect(verifier.verify(`${header}.${body}.`)).rejects.toThrow();
  });

  it('rejects a token without a subject', async () => {
    await expect(verifier.verify(await issuer.sign({ sub: undefined }))).rejects.toThrow('claim "sub"');
  });

  it('rejects garbage', async () => {
    await expect(verifier.verify('not-a-token')).rejects.toThrow('malformed token');
  });
});
