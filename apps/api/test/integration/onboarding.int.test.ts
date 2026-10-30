import { type OnboardingOverview, type SchoolSummary } from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, get, secret, tokenFor } from './helpers';

// Adding a school through the API (M3.1), against the real stack: the group
// administrator creates a company, a draft school, offerings with prices,
// session calendars and a principal, then activates it. Test schools use the
// code prefix "test-"; scripts/db-reset-test-data.sh removes them before a run.

const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const CHESS = 'd1000000-0000-7000-8000-000000000002';
const run = Date.now().toString(36);
const code = `test-${run}`;

const tokens: Record<string, string> = {};
let worker: Client;
let companyId: string;
let schoolId: string;
let lunchId: string;
let clubId: string;
let tablesBefore: number;

const TABLES = `SELECT count(*)::int AS tables FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema')`;

/** Next Monday as a calendar date, so every run books in the future. */
function nextMonday(): Date {
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7));
  return day;
}
const plus = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
const monday = nextMonday();

async function post<T>(user: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens[user]!}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as T & { message?: string } };
}
const school = async () =>
  (await get<OnboardingOverview>('/admin/onboarding', tokens.admin!)).body.schools.find(
    (s) => s.id === schoolId,
  )!;

beforeAll(async () => {
  for (const user of ['admin', 'ceo', 'principal.a', 'anna.ivanova']) tokens[user] = await tokenFor(user);
  worker = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_worker',
    password: secret('pg_worker_password'),
  });
  await worker.connect();
  tablesBefore = (await worker.query<{ tables: number }>(TABLES)).rows[0]!.tables;
});

afterAll(async () => {
  await worker.end();
});

describe('who may add schools', () => {
  it('shows the group administrator the companies and services to start from', async () => {
    const { status, body } = await get<OnboardingOverview>('/admin/onboarding', tokens.admin!);
    expect(status).toBe(200);
    expect(body.billingEntities.map((entity) => entity.legalName)).toContain('Testing Company');
    expect(body.serviceDefinitions.map((service) => service.code)).toEqual(
      expect.arrayContaining(['lunch', 'chess']),
    );
  });

  it('is closed to principals and parents', async () => {
    expect((await get('/admin/onboarding', tokens['principal.a']!)).status).toBe(403);
    expect((await get('/admin/onboarding', tokens['anna.ivanova']!)).status).toBe(403);
    expect(
      (await post('principal.a', '/admin/billing-entities', { legalName: 'Nope', registrationNumber: '1' }))
        .status,
    ).toBe(403);
  });

  it('needs the company registration number', async () => {
    expect(
      (await post('admin', '/admin/billing-entities', { legalName: `Test company ${run}-x` })).status,
    ).toBe(400);
  });
});

describe('adding School T', () => {
  it('adds a billing company and a draft school', async () => {
    const company = await post<{ id: string }>('admin', '/admin/billing-entities', {
      legalName: `Test company ${run}`,
      registrationNumber: String(Date.now()).slice(-9),
    });
    expect(company.status).toBe(201);
    companyId = company.body.id;

    const created = await post<OnboardingOverview['schools'][number]>('admin', '/admin/schools', {
      code,
      name: `School T ${run}`,
      kind: 'school',
      timeZone: 'Europe/Sofia',
      billingEntityId: companyId,
    });
    expect(created.status).toBe(201);
    schoolId = created.body.id;
    expect(created.body).toMatchObject({ code, status: 'draft', billingEntityId: companyId });
    expect(created.body.missing).toEqual(['at least one published offering with a price', 'a principal']);
  });

  it('refuses a duplicate code, an unknown time zone and a malformed code', async () => {
    const base = { name: 'Duplicate', kind: 'school', timeZone: 'Europe/Sofia', billingEntityId: companyId };
    expect((await post('admin', '/admin/schools', { ...base, code })).status).toBe(409);
    expect(
      (await post('admin', '/admin/schools', { ...base, code: `${code}-tz`, timeZone: 'Mars/Base' })).status,
    ).toBe(422);
    expect((await post('admin', '/admin/schools', { ...base, code: 'School T' })).status).toBe(400);
  });

  it('keeps a draft school out of public lists', async () => {
    const { body } = await get<SchoolSummary[]>('/schools', tokens['anna.ivanova']!);
    expect(body.map((entry) => entry.id)).not.toContain(schoolId);
  });

  it('adds lunch and a club with their first prices', async () => {
    const lunch = await post<{ offeringId: string }>('admin', `/admin/schools/${schoolId}/offerings`, {
      serviceDefinitionId: LUNCH,
      name: `Lunch at School T ${run}`,
      unitAmountMinor: 520,
      priceUnit: 'per_day',
    });
    expect(lunch.status).toBe(201);
    lunchId = lunch.body.offeringId;
    const club = await post<{ offeringId: string }>('admin', `/admin/schools/${schoolId}/offerings`, {
      serviceDefinitionId: CHESS,
      name: `Chess club, School T ${run}`,
      unitAmountMinor: 5500,
      priceUnit: 'per_term',
    });
    expect(club.status).toBe(201);
    clubId = club.body.offeringId;
    expect(
      (
        await post('ceo', `/admin/schools/${schoolId}/offerings`, {
          serviceDefinitionId: LUNCH,
          name: 'CEO lunch',
          unitAmountMinor: 1,
          priceUnit: 'per_day',
        })
      ).status,
    ).toBe(403);
  });

  it('will not activate the school before it has sessions and a principal', async () => {
    const { status, body } = await post('admin', `/admin/schools/${schoolId}/activate`);
    expect(status).toBe(409);
    expect(body.message).toContain('a principal');
  });

  it('generates lunch on school days, skipping closures, and never twice', async () => {
    const schedule = {
      type: 'school_days',
      from: plus(monday, 0),
      to: plus(monday, 13),
      closed: [plus(monday, 2)],
    };
    const first = await post<{ created: number; skipped: number }>(
      'admin',
      `/admin/schools/${schoolId}/sessions`,
      {
        offeringId: lunchId,
        capacity: 80,
        schedule,
      },
    );
    expect(first).toMatchObject({ status: 201, body: { created: 9, skipped: 0 } });
    const again = await post('admin', `/admin/schools/${schoolId}/sessions`, {
      offeringId: lunchId,
      capacity: 80,
      schedule,
    });
    expect(again.body).toEqual({ created: 0, skipped: 9 });

    // Booking closes at 10:00 school time the day before.
    const { rows } = await worker.query<{ cutoff: string }>(
      `SELECT to_char(booking_cutoff_at AT TIME ZONE 'Europe/Sofia', 'YYYY-MM-DD HH24:MI') AS cutoff
         FROM scheduling.session WHERE offering_id = $1 AND service_date = $2`,
      [lunchId, plus(monday, 1)],
    );
    expect(rows[0]!.cutoff).toBe(`${plus(monday, 0)} 10:00`);
  });

  it('generates weekly club meetings in the school time zone', async () => {
    const created = await post<{ created: number }>('admin', `/admin/schools/${schoolId}/sessions`, {
      offeringId: clubId,
      capacity: 12,
      location: 'Room 3',
      schedule: {
        type: 'weekly',
        weekday: 3,
        startTime: '14:00',
        endTime: '15:00',
        from: plus(monday, 0),
        to: plus(monday, 27),
      },
    });
    expect(created.body.created).toBe(4);
    const { rows } = await worker.query<{ local: string }>(
      `SELECT DISTINCT to_char(starts_at AT TIME ZONE 'Europe/Sofia', 'Dy HH24:MI') AS local
         FROM scheduling.session WHERE offering_id = $1`,
      [clubId],
    );
    expect(rows).toEqual([{ local: 'Wed 14:00' }]);
  });

  it('refuses calendars that do not fit the offering or the dates', async () => {
    const weekly = {
      type: 'weekly',
      weekday: 1,
      startTime: '12:00',
      endTime: '13:00',
      from: plus(monday, 0),
      to: plus(monday, 6),
    };
    expect(
      (
        await post('admin', `/admin/schools/${schoolId}/sessions`, {
          offeringId: lunchId,
          capacity: 5,
          schedule: weekly,
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await post('admin', `/admin/schools/${schoolId}/sessions`, {
          offeringId: lunchId,
          capacity: 5,
          schedule: { type: 'school_days', from: plus(monday, 5), to: plus(monday, 0) },
        })
      ).status,
    ).toBe(422);
  });

  it('registers a principal for the school', async () => {
    const created = await post<{ personId: string; roleCode: string }>(
      'admin',
      `/admin/schools/${schoolId}/staff`,
      {
        givenName: 'Tanya',
        familyName: 'Principal',
        email: `principal.${run}@pythagoras.test`,
        roleCode: 'principal',
      },
    );
    expect(created).toMatchObject({ status: 201, body: { roleCode: 'principal' } });
    expect((await school()).missing).toEqual([]);
  });

  it('activates the school; it then appears for everyone', async () => {
    const { status, body } = await post<OnboardingOverview['schools'][number]>(
      'admin',
      `/admin/schools/${schoolId}/activate`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'active', publishedOfferings: 2, principals: 1, sessions: 13 });
    const schools = await get<SchoolSummary[]>('/schools', tokens['anna.ivanova']!);
    expect(schools.body.map((entry) => entry.code)).toContain(code);
    expect((await post('admin', `/admin/schools/${schoolId}/activate`)).status).toBe(409);
  });

  it('created no tables: a new school is data only', async () => {
    expect((await worker.query<{ tables: number }>(TABLES)).rows[0]!.tables).toBe(tablesBefore);
  });
});
