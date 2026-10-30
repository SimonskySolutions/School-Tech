import { type SchoolSetup, type WebsiteDomain } from '@pythagoras/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemDatabase } from '../../src/database/system-database';
import { verifyDomains } from '../../src/worker/domain-verification';
import { API, get, post, secret, tokenFor } from './helpers';

// Real domains (M3.6) against the real database: added by the administrator,
// pending until the worker finds the DNS record, and only then routed and
// allowed a certificate. DNS itself is a stand-in here: the test domain does
// not exist, so the resolver answers with the record for it alone.

const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const run = Date.now().toString(36);
const code = `test-${run}-dom`;
const domain = `www.${code}.pythagoras-schools.bg`;
const tokens: Record<string, string> = {};
let schoolId: string;
let added: WebsiteDomain;
let system: SystemDatabase;

const allowed = (hostname: string) => fetch(`${API}/internal/tls/allowed?domain=${hostname}`);
const resolve = (hostname: string) => fetch(`${API}/sites/resolve?host=${hostname}`);
const setup = async () => (await get<SchoolSetup>(`/admin/schools/${schoolId}`, tokens.admin!)).body;

function nextMonday(): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  return day.toISOString().slice(0, 10);
}

beforeAll(async () => {
  for (const user of ['admin', 'principal.a']) tokens[user] = await tokenFor(user);
  system = new SystemDatabase({
    host: 'postgres',
    port: 5432,
    database: 'pythagoras',
    user: 'pyth_worker',
    password: secret('pg_worker_password'),
    max: 1,
  });
  const admin = tokens.admin!;
  const company = await post<{ id: string }>(admin, '/admin/billing-entities', {
    legalName: `Test company ${run} domains`,
    registrationNumber: String(Date.now()).slice(-9),
  });
  schoolId = (
    await post<{ id: string }>(admin, '/admin/schools', {
      code,
      name: `School R ${run}`,
      kind: 'school',
      timeZone: 'Europe/Sofia',
      billingEntityId: company.body.id,
    })
  ).body.id;
});

afterAll(async () => {
  await system.close();
});

describe('adding a real domain', () => {
  it("needs the school's website first", async () => {
    const { status, body } = await post(tokens.admin!, `/admin/schools/${schoolId}/website/domains`, {
      hostname: domain,
    });
    expect(status).toBe(409);
    expect(body.message).toContain('website first');
  });

  it('is pending, with the DNS record the school must create', async () => {
    await post(tokens.admin!, `/admin/schools/${schoolId}/website`);
    const { status, body } = await post<WebsiteDomain>(
      tokens.admin!,
      `/admin/schools/${schoolId}/website/domains`,
      {
        hostname: ` ${domain.toUpperCase()} `,
      },
    );
    expect(status).toBe(201);
    added = body;
    expect(added).toMatchObject({
      hostname: domain,
      status: 'pending',
      method: 'dns_txt',
      lastCheckedAt: null,
    });
    expect(added.instructions).toMatchObject({ type: 'TXT', name: `_pythagoras-verify.${domain}` });
    expect(added.instructions!.value).toMatch(/^pythagoras-site-verification=[A-Za-z0-9_-]{32}$/);
  });

  it('refuses names that are not real domains, a domain in use, and other roles', async () => {
    const path = `/admin/schools/${schoolId}/website/domains`;
    expect((await post(tokens.admin!, path, { hostname: 'not a domain' })).status).toBe(400);
    expect((await post(tokens.admin!, path, { hostname: `${code}.pythagoras.localhost` })).status).toBe(400);
    expect((await post(tokens.admin!, path, { hostname: domain })).status).toBe(409);
    expect((await post(tokens['principal.a']!, path, { hostname: `x.${domain}` })).status).toBe(403);
  });

  it('is neither routed nor given a certificate while pending', async () => {
    expect((await allowed(domain)).status).toBe(404);
    expect((await resolve(domain)).status).toBe(404);
  });
});

describe('verification by the worker', () => {
  const record = () => [[added.instructions!.value]];

  it('stays pending while the record is missing', async () => {
    await post(tokens.admin!, `/admin/schools/${schoolId}/website/domains/${added.id}/check`);
    await verifyDomains(system, () => Promise.resolve([]));
    const [entry] = (await setup()).website!.hostnames.filter((d) => d.hostname === domain);
    expect(entry).toMatchObject({ status: 'pending' });
    expect(entry!.lastCheckedAt).not.toBeNull();
  });

  it('marks the domain verified once the record is there', async () => {
    const check = await post<WebsiteDomain>(
      tokens.admin!,
      `/admin/schools/${schoolId}/website/domains/${added.id}/check`,
    );
    expect(check.body.lastCheckedAt).toBeNull();
    const result = await verifyDomains(system, (name) =>
      Promise.resolve(name === added.instructions!.name ? record() : []),
    );
    expect(result.verified).toBeGreaterThanOrEqual(1);
    const [entry] = (await setup()).website!.hostnames.filter((d) => d.hostname === domain);
    expect(entry).toMatchObject({ status: 'verified', instructions: null });
  });

  it('routes the domain and allows its certificate once the school is live', async () => {
    // The website is still a draft with its school.
    expect((await allowed(domain)).status).toBe(404);
    const admin = tokens.admin!;
    const lunch = await post<{ offeringId: string }>(admin, `/admin/schools/${schoolId}/offerings`, {
      serviceDefinitionId: LUNCH,
      name: `Lunch at School R ${run}`,
      unitAmountMinor: 500,
      priceUnit: 'per_day',
    });
    const monday = nextMonday();
    await post(admin, `/admin/schools/${schoolId}/sessions`, {
      offeringId: lunch.body.offeringId,
      capacity: 40,
      schedule: { type: 'school_days', from: monday, to: monday },
    });
    await post(admin, `/admin/schools/${schoolId}/staff`, {
      givenName: 'Rada',
      familyName: 'Principal',
      email: `test-${run}-dom-principal@pythagoras.test`,
      roleCode: 'principal',
    });
    expect((await post(admin, `/admin/schools/${schoolId}/activate`)).status).toBe(200);

    expect((await allowed(domain)).status).toBe(200);
    const site = await resolve(domain);
    expect(site.status).toBe(200);
    expect(await site.json()).toMatchObject({ code, name: `School R ${run}` });
  });

  it('never lets the API mark a domain verified itself', async () => {
    const other = await post<WebsiteDomain>(tokens.admin!, `/admin/schools/${schoolId}/website/domains`, {
      hostname: `shop.${code}.pythagoras-schools.bg`,
    });
    expect(other.body.status).toBe('pending');
    // The only API ways in are "add" (pending) and "check again" (pending); there is no "verify".
    const again = await post<WebsiteDomain>(
      tokens.admin!,
      `/admin/schools/${schoolId}/website/domains/${other.body.id}/check`,
    );
    expect(again.body.status).toBe('pending');
    expect((await allowed(other.body.hostname)).status).toBe(404);
  });
});
