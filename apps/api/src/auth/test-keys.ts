import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose';

// Test-only helper: a local signing key and JWKS standing in for Keycloak.
// Not imported by application code.

export const TEST_ISSUER = 'http://localhost:58080/realms/pythagoras';
export const TEST_AUDIENCE = 'pythagoras-api';

type SigningKey = Parameters<SignJWT['sign']>[0];

export async function createTestIssuer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const other = await generateKeyPair('RS256', { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const keys = createLocalJWKSet({ keys: [jwk] });

  const sign = (
    claims: JWTPayload = {},
    // expires: a duration ("5m") or an absolute epoch second.
    options: { key?: SigningKey; kid?: string; expires?: string | number; issuedAt?: number } = {},
  ) =>
    new SignJWT({
      typ: 'Bearer',
      azp: 'pythagoras-web',
      aud: TEST_AUDIENCE,
      iss: TEST_ISSUER,
      sub: 'f1000000-0000-7000-8000-000000000020',
      ...claims,
    })
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'test-key' })
      .setIssuedAt(options.issuedAt)
      .setExpirationTime(options.expires ?? '5m')
      .sign(options.key ?? privateKey);

  return { keys, sign, otherPrivateKey: other.privateKey };
}
