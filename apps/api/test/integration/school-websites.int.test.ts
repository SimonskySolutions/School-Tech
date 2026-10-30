import { type CreatedWebsiteResponse, type SchoolSetup } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, post, tokenFor } from './helpers';

// A new school's own website (M3.5), against the real stack: created by the
// group administrator, answering on its local address, offline while the
// school is a draft, live with the school, with its space in the CMS. Test
// schools and websites use the "test-" prefix and are removed before each run.

const CMS = process.env.CMS_URL ?? 'http://cms:3000';
const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const run = Date.now().toString(36);
const code = `test-${run}-site`;
const host = `${code}.pythagoras.localhost`;
const tokens: Record<string, string> = {};
let schoolId: string;

const resolve = (hostname: string) => fetch(`${API}/sites/resolve?host=${hostname}`);

function nextMonday(): string {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  return day.toISOString().slice(0, 10);
}

beforeAll(async () => {
  for (const user of ['admin', 'principal.a']) tokens[user] = await tokenFor(user);
  const company = await post<{ id: string }>(tokens.admin!, '/admin/billing-entities', {
    legalName: `Test company ${run} site`,
    registrationNumber: String(Date.now()).slice(-9),
  });
  schoolId = (
    await post<{ id: string }>(tokens.admin!, '/admin/schools', {
      code,
      name: `School S ${run}`,
      kind: 'school',
      timeZone: 'Europe/Sofia',
      billingEntityId: company.body.id,
    })
  ).body.id;
});

describe("a new school's website", () => {
  it('is created for the school, on its local address, with its space in the CMS', async () => {
    const { status, body } = await post<CreatedWebsiteResponse>(
      tokens.admin!,
      `/admin/schools/${schoolId}/website`,
    );
    expect(status).toBe(201);
    expect(body).toMatchObject({
      code,
      status: 'draft',
      cmsKey: code,
      existing: false,
      cms: 'created',
      hostnames: [{ hostname: host, status: 'verified' }],
    });
    const tenants = (await (await fetch(`${CMS}/api/websites?where[key][equals]=${code}`)).json()) as {
      docs: { name: string }[];
    };
    expect(tenants.docs.map((tenant) => tenant.name)).toEqual([`School S ${run}`]);
  });

  it('is created only once', async () => {
    const { status, body } = await post<CreatedWebsiteResponse>(
      tokens.admin!,
      `/admin/schools/${schoolId}/website`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ existing: true, cms: 'existing' });
    const setup = await get<SchoolSetup>(`/admin/schools/${schoolId}`, tokens.admin!);
    expect(setup.body.website).toMatchObject({ code, status: 'draft' });
  });

  it('is offline while the school is a draft', async () => {
    expect((await resolve(host)).status).toBe(404);
  });

  it('is for group administrators only', async () => {
    expect((await post(tokens['principal.a']!, `/admin/schools/${schoolId}/website`)).status).toBe(403);
  });

  it('goes live with the school', async () => {
    const admin = tokens.admin!;
    const lunch = await post<{ offeringId: string }>(admin, `/admin/schools/${schoolId}/offerings`, {
      serviceDefinitionId: LUNCH,
      name: `Lunch at School S ${run}`,
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
      givenName: 'Sava',
      familyName: 'Principal',
      email: `test-${run}-site-principal@pythagoras.test`,
      roleCode: 'principal',
    });
    expect((await post(admin, `/admin/schools/${schoolId}/activate`)).status).toBe(200);

    const live = await resolve(host);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({
      code,
      name: `School S ${run}`,
      cmsKey: code,
      schools: [{ name: `School S ${run}`, kind: 'school' }],
    });
  });
});
