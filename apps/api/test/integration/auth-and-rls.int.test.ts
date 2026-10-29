import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs against the real stack: API, Keycloak and the seeded PostgreSQL.
// Tokens come from Keycloak's development-only test client (synthetic users).

const API = process.env.API_URL ?? 'http://api:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://keycloak:8080';
const PASSWORD = readFileSync(
  process.env.DEV_PASSWORD_FILE ?? '/workspace/secrets/keycloak_dev_user_password',
  'utf8',
).trim();

async function tokenFor(username: string): Promise<string> {
  const response = await fetch(`${KEYCLOAK}/realms/pythagoras/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'pythagoras-dev-tests',
      username,
      password: PASSWORD,
    }),
  });
  if (!response.ok) throw new Error(`token for ${username}: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function api(path: string, token?: string) {
  const response = await fetch(`${API}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

interface Me {
  person: { id: string; givenName: string };
  roles: { code: string; scope: string; school: { name: string } | null }[];
  children: {
    givenName: string;
    capabilities: { pay: boolean };
    enrolments: { school: { code: string } }[];
  }[];
}

const tokens: Record<string, string> = {};

beforeAll(async () => {
  for (const user of [
    'anna.ivanova',
    'hristo.georgiev',
    'teodora.marinova',
    'principal.a',
    'ceo',
    'schoollife',
    'unlinked',
  ]) {
    tokens[user] = await tokenFor(`${user}@pythagoras.test`);
  }
});

describe('sign-in through the API', () => {
  it('refuses requests without a token', async () => {
    expect((await api('/me')).status).toBe(401);
  });

  it('refuses a token whose signature was tampered with', async () => {
    const token = tokens['anna.ivanova']!;
    const tampered = token.slice(0, -4) + (token.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect((await api('/me', tampered)).status).toBe(401);
  });

  it('refuses a Keycloak admin token (other realm, no API audience)', async () => {
    const admin = await fetch(`${KEYCLOAK}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'admin',
        password: readFileSync('/workspace/secrets/keycloak_admin_password', 'utf8').trim(),
      }),
    });
    const { access_token } = (await admin.json()) as { access_token: string };
    expect((await api('/me', access_token)).status).toBe(401);
  });

  it('refuses a valid sign-in that has no Pythagoras account (403)', async () => {
    expect((await api('/me', tokens.unlinked)).status).toBe(403);
  });
});

describe('each person sees their own world', () => {
  it('Anna sees her two children at School A and School C', async () => {
    const { status, body } = await api('/me', tokens['anna.ivanova']);
    expect(status).toBe(200);
    const me = body as Me;
    expect(me.person.givenName).toBe('Anna');
    expect(me.roles).toEqual([]);
    expect(
      me.children.map((child) => [
        child.givenName,
        child.enrolments.map((e) => e.school.code),
        child.capabilities.pay,
      ]),
    ).toEqual([
      ['Boris', ['school-c'], true],
      ['Mila', ['school-a'], true],
    ]);
  });

  it('Hristo sees only his child at School B', async () => {
    const me = (await api('/me', tokens['hristo.georgiev'])).body as Me;
    expect(me.children.map((child) => child.givenName)).toEqual(['Kalina']);
  });

  it('a parent with an unverified request sees no children', async () => {
    const me = (await api('/me', tokens['teodora.marinova'])).body as Me;
    expect(me.children).toEqual([]);
  });

  it('the principal of School A holds a School A role and no children', async () => {
    const me = (await api('/me', tokens['principal.a'])).body as Me;
    expect(me.roles.map((role) => [role.code, role.scope, role.school?.name])).toEqual([
      ['principal', 'school', 'School A'],
    ]);
    expect(me.children).toEqual([]);
  });

  it('the CEO and School Life hold group-wide roles', async () => {
    expect(((await api('/me', tokens.ceo)).body as Me).roles.map((role) => [role.code, role.scope])).toEqual([
      ['group_ceo', 'group'],
    ]);
    expect(((await api('/me', tokens.schoollife)).body as Me).roles.map((role) => role.code)).toEqual([
      'school_life_coordinator',
    ]);
  });

  it('everyone signed in sees the three active schools', async () => {
    const { status, body } = await api('/schools', tokens['hristo.georgiev']);
    expect(status).toBe(200);
    expect((body as { code: string }[]).map((school) => school.code)).toEqual([
      'school-a',
      'school-b',
      'school-c',
    ]);
  });
});
