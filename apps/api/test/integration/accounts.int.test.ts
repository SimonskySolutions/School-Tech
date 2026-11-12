import { type CreatedAccountResponse, type MeResponse, type OnboardingOverview } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, keycloakAdmin, passwordGrant, tokenFor } from './helpers';

// Sign-in accounts for people an administrator registers (M3.2), against the
// real Keycloak: the account is created by the provisioning service account,
// linked to the person, and must get a new password at first sign-in. The
// test people use "test-" e-mail addresses; scripts/db-reset-test-data.sh
// removes them, their school and their Keycloak users before each run.

const run = Date.now().toString(36);
const tokens: Record<string, string> = {};
let schoolId: string;
let principalId: string;
let duplicateId: string;
let created: CreatedAccountResponse;

async function post<T>(user: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens[user]!}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    cache: response.headers.get('cache-control'),
    body: (await response.json()) as T & { message?: string },
  };
}

beforeAll(async () => {
  for (const user of ['admin', 'principal.a', 'anna.ivanova']) tokens[user] = await tokenFor(user);
  const { body } = await get<OnboardingOverview>('/admin/onboarding', tokens.admin!);
  const company = body.billingEntities.find((entity) => entity.legalName === 'Testing Company')!;
  schoolId = (
    await post<{ id: string }>('admin', '/admin/schools', {
      code: `test-${run}-acc`,
      name: `School T ${run} (accounts)`,
      kind: 'school',
      timeZone: 'Europe/Sofia',
      billingEntityId: company.id,
    })
  ).body.id;
  principalId = (
    await post<{ personId: string }>('admin', `/admin/schools/${schoolId}/staff`, {
      givenName: 'Tanya',
      familyName: 'Principal',
      email: `test-${run}-principal@pythagoras.test`,
      roleCode: 'principal',
    })
  ).body.personId;
  // Someone registered with an address that already has a sign-in account.
  duplicateId = (
    await post<{ personId: string }>('admin', `/admin/schools/${schoolId}/staff`, {
      givenName: 'Anna',
      familyName: 'Again',
      email: 'anna.ivanova@pythagoras.test',
      roleCode: 'teacher',
    })
  ).body.personId;
});

describe('who may create sign-in accounts', () => {
  it('refuses principals and parents', async () => {
    expect((await post('principal.a', `/admin/people/${principalId}/account`)).status).toBe(403);
    expect((await post('anna.ivanova', `/admin/people/${principalId}/account`)).status).toBe(403);
  });

  it('answers 404 for someone who does not exist', async () => {
    expect((await post('admin', `/admin/people/01900000-0000-7000-8000-000000000000/account`)).status).toBe(
      404,
    );
  });
});

describe('creating the account', () => {
  it('creates and links the account, with a one-time temporary password', async () => {
    const response = await post<CreatedAccountResponse>('admin', `/admin/people/${principalId}/account`);
    expect(response.status).toBe(201);
    expect(response.cache).toBe('no-store');
    created = response.body;
    expect(created).toMatchObject({
      personId: principalId,
      username: `test-${run}-principal@pythagoras.test`,
      setup: 'temporary_password',
    });
    expect(created.temporaryPassword).toMatch(/^[A-Za-z0-9]{24}$/);
  });

  it('refuses a second account for the same person', async () => {
    expect((await post('admin', `/admin/people/${principalId}/account`)).status).toBe(409);
  });

  it('refuses an address that already signs in, and links nothing', async () => {
    const response = await post('admin', `/admin/people/${duplicateId}/account`);
    expect(response.status).toBe(409);
    expect(response.body.message).toContain('already exists');
    // Anna still signs in as Anna.
    const me = await get<MeResponse>('/me', await tokenFor('anna.ivanova'));
    expect(me.body.person.givenName).toBe('Anna');
  });

  it('makes the person choose a new password before the first sign-in', async () => {
    const admin = await keycloakAdmin();
    const users = (await (
      await admin(`/users?username=${encodeURIComponent(created.username)}&exact=true`)
    ).json()) as {
      id: string;
      requiredActions: string[];
      emailVerified: boolean;
    }[];
    expect(users).toHaveLength(1);
    expect(users[0]!.requiredActions).toEqual(['UPDATE_PASSWORD']);

    const refused = await passwordGrant(created.username, created.temporaryPassword!);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error_description: string }).error_description).toMatch(
      /not fully set up/i,
    );
  });

  it('signs the person in as their own record, with their role at the new school, once set up', async () => {
    // Stand in for the person completing the "update password" step.
    const admin = await keycloakAdmin();
    const [user] = (await (
      await admin(`/users?username=${encodeURIComponent(created.username)}&exact=true`)
    ).json()) as {
      id: string;
    }[];
    const chosen = `Chosen-${run}-Passw0rd`;
    expect(
      (await admin(`/users/${user!.id}`, { method: 'PUT', body: JSON.stringify({ requiredActions: [] }) }))
        .ok,
    ).toBe(true);
    expect(
      (
        await admin(`/users/${user!.id}/reset-password`, {
          method: 'PUT',
          body: JSON.stringify({ type: 'password', value: chosen, temporary: false }),
        })
      ).ok,
    ).toBe(true);

    const signedIn = await passwordGrant(created.username, chosen);
    expect(signedIn.status).toBe(200);
    const { access_token } = (await signedIn.json()) as { access_token: string };
    const me = await get<MeResponse>('/me', access_token);
    expect(me.status).toBe(200);
    expect(me.body.person).toMatchObject({ id: principalId, givenName: 'Tanya' });
    // The school is still a draft, which only group administrators may see.
    expect(me.body.roles.map((role) => [role.code, role.scope, role.school])).toEqual([
      ['principal', 'school', null],
    ]);
  });
});
