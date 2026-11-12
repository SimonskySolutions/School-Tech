import { describe, expect, it } from 'vitest';
import { loadWebConfig } from './config';
import { beginSignIn, oidcConfiguration } from './oidc';

const config = loadWebConfig(
  { OIDC_CLIENT_SECRET: 'client-secret-0123456789', SESSION_SECRET: 'a'.repeat(64) },
  () => '',
);
const oidc = oidcConfiguration(config);

describe('beginning a sign-in', () => {
  it('asks for the code flow with PKCE and no particular sign-in level', async () => {
    const { url, transaction } = await beginSignIn(oidc, config, '/children');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('acr_values')).toBe(false);
    expect(transaction).toMatchObject({ returnTo: '/children' });
    expect(transaction.secondFactor).toBeUndefined();
  });

  it('asks Keycloak for the second factor when staff need it (M8.3)', async () => {
    const { url, transaction } = await beginSignIn(oidc, config, '/', { secondFactor: true });
    expect(url.searchParams.get('acr_values')).toBe('mfa');
    expect(transaction.secondFactor).toBe(true);
  });
});
