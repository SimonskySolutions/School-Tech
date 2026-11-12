import { describe, expect, it } from 'vitest';
import { AccountExists, KeycloakDirectory, keycloakUser, temporaryPassword } from './keycloak-directory';

const account = { email: 'Tanya.Principal@Pythagoras.test', givenName: 'Tanya', familyName: 'Principal' };

/** A fake Keycloak that records calls and answers each path from a table. */
function fakeKeycloak(answers: Record<string, () => Response>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetch: typeof globalThis.fetch = (url, init) => {
    const path = new URL(url instanceof Request ? url.url : url.toString()).pathname;
    const method = init?.method ?? 'GET';
    const raw = init?.body;
    const body: unknown =
      typeof raw === 'string' ? JSON.parse(raw) : raw instanceof URLSearchParams ? raw.toString() : raw;
    calls.push({ method, path, body });
    const answer = answers[`${method} ${path}`];
    return Promise.resolve(answer ? answer() : new Response('not found', { status: 404 }));
  };
  return { fetch, calls };
}

const TOKEN = 'POST /realms/pythagoras/protocol/openid-connect/token';
const USERS = 'POST /admin/realms/pythagoras/users';
const token = () => Response.json({ access_token: 'service-token', expires_in: 300 });
const createdUser = () =>
  new Response(null, {
    status: 201,
    headers: { location: 'http://keycloak:8080/admin/realms/pythagoras/users/kc-123' },
  });

const directory = (
  fetch: typeof globalThis.fetch,
  setup: 'temporary_password' | 'email' = 'temporary_password',
) =>
  new KeycloakDirectory({
    baseUrl: 'http://keycloak:8080',
    realm: 'pythagoras',
    clientId: 'pythagoras-provisioning',
    clientSecret: 'provisioning-secret-value',
    setup,
    fetch,
  });

describe('temporaryPassword', () => {
  it('is 24 readable characters, without look-alikes', () => {
    const password = temporaryPassword();
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{24}$/);
    expect(temporaryPassword()).not.toBe(password);
  });
});

describe('keycloakUser', () => {
  it('uses the lower-cased e-mail as user name and requires a new password', () => {
    expect(keycloakUser(account, 'temporary_password')).toEqual({
      username: 'tanya.principal@pythagoras.test',
      email: 'tanya.principal@pythagoras.test',
      firstName: 'Tanya',
      lastName: 'Principal',
      enabled: true,
      emailVerified: true,
      requiredActions: ['UPDATE_PASSWORD'],
    });
    expect(keycloakUser(account, 'email')).toMatchObject({
      emailVerified: false,
      requiredActions: ['UPDATE_PASSWORD', 'VERIFY_EMAIL'],
    });
  });
});

describe('KeycloakDirectory', () => {
  it('creates the user as the service account and sets a temporary password', async () => {
    const keycloak = fakeKeycloak({
      [TOKEN]: token,
      [USERS]: createdUser,
      'PUT /admin/realms/pythagoras/users/kc-123/reset-password': () => new Response(null, { status: 204 }),
    });
    const created = await directory(keycloak.fetch).createAccount(account);
    expect(created.subject).toBe('kc-123');
    expect(created.temporaryPassword).toHaveLength(24);
    expect(keycloak.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      TOKEN,
      USERS,
      'PUT /admin/realms/pythagoras/users/kc-123/reset-password',
    ]);
    expect(keycloak.calls[0]!.body).toContain('grant_type=client_credentials');
    expect(keycloak.calls[2]!.body).toEqual({
      type: 'password',
      value: created.temporaryPassword,
      temporary: true,
    });
  });

  it('asks Keycloak to e-mail the set-up link when configured for e-mail', async () => {
    const keycloak = fakeKeycloak({
      [TOKEN]: token,
      [USERS]: createdUser,
      'PUT /admin/realms/pythagoras/users/kc-123/execute-actions-email': () =>
        new Response(null, { status: 204 }),
    });
    expect(await directory(keycloak.fetch, 'email').createAccount(account)).toEqual({
      subject: 'kc-123',
      temporaryPassword: null,
    });
  });

  it('reports an e-mail that already has an account', async () => {
    const keycloak = fakeKeycloak({ [TOKEN]: token, [USERS]: () => new Response(null, { status: 409 }) });
    await expect(directory(keycloak.fetch).createAccount(account)).rejects.toBeInstanceOf(AccountExists);
  });

  it('removes the half-made user when the password step fails', async () => {
    const keycloak = fakeKeycloak({
      [TOKEN]: token,
      [USERS]: createdUser,
      'PUT /admin/realms/pythagoras/users/kc-123/reset-password': () => new Response(null, { status: 400 }),
      'DELETE /admin/realms/pythagoras/users/kc-123': () => new Response(null, { status: 204 }),
    });
    await expect(directory(keycloak.fetch).createAccount(account)).rejects.toThrow('temporary password');
    expect(keycloak.calls.at(-1)).toMatchObject({
      method: 'DELETE',
      path: '/admin/realms/pythagoras/users/kc-123',
    });
  });

  it('reuses its service token until shortly before it expires', async () => {
    const keycloak = fakeKeycloak({
      [TOKEN]: token,
      'DELETE /admin/realms/pythagoras/users/a': () => new Response(null, { status: 204 }),
      'DELETE /admin/realms/pythagoras/users/b': () => new Response(null, { status: 404 }),
    });
    const target = directory(keycloak.fetch);
    await target.deleteAccount('a');
    await target.deleteAccount('b');
    expect(keycloak.calls.filter((call) => call.path.endsWith('/token'))).toHaveLength(1);
  });
});
