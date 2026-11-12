import { type StudentOfferings, type StudentTrips, type TripParticipants } from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, get, MILA, payAndWait, placeOrder, post, secret, tokenFor } from './helpers';

// Trips and consent (M4.4) against the real stack. The seed has a museum visit
// for School A ten days after seeding, with consent wording. Anna gives
// permission for Mila, books and pays, School Life sees the participant list,
// and Anna withdraws: the place is cancelled and the payment becomes credit.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const MUSEUM = 'd2000000-0000-7000-8000-0000000000a7';
const ANNA = 'c1000000-0000-7000-8000-000000000020';

const tokens: Record<string, string> = {};
let annaDb: Client;
let original = '';

const trips = async () => (await get<StudentTrips>(`/students/${MILA}/trips`, tokens['anna.ivanova']!)).body;
const museum = async () => (await trips()).trips.find((trip) => trip.offeringId === MUSEUM)!;
const contact = {
  emergencyContactName: 'Grandma Ivanova (synthetic)',
  emergencyContactPhone: '+359 88 123 4567',
};

async function send<T>(method: string, user: string, path: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[user]}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : null) as T & { message?: string } };
}

/** Anna's credits, read as Anna through the API role (holders read their own). */
async function credits(): Promise<{ reason: string; original_amount_minor: string }[]> {
  await annaDb.query('BEGIN');
  try {
    await annaDb.query(`SELECT set_config('app.person_id', $1, true)`, [ANNA]);
    return (
      await annaDb.query<{ reason: string; original_amount_minor: string }>(
        `SELECT reason, original_amount_minor FROM commerce.account_credit WHERE reason LIKE 'Trip permission withdrawn%'`,
      )
    ).rows;
  } finally {
    await annaDb.query('ROLLBACK');
  }
}

beforeAll(async () => {
  for (const user of [
    'anna.ivanova',
    'schoollife',
    'kitchen.a',
    'ceo',
    'hristo.georgiev',
    'principal.a',
    'admin',
  ]) {
    tokens[user] = await tokenFor(user);
  }
  annaDb = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_api',
    password: secret('pg_api_password'),
  });
  await annaDb.connect();
  original = (await museum()).consent!.wording;
});

afterAll(async () => {
  // Put the seeded wording back (as a new version).
  if (original) {
    await send('PUT', 'admin', `/admin/schools/${SCHOOL_A}/offerings/${MUSEUM}/trip-consent`, {
      text: original,
    });
  }
  await annaDb?.end();
});

describe('permission before booking', () => {
  it('shows Anna the trip, its wording, and that permission is needed first', async () => {
    const { body } = await get<StudentOfferings>(`/students/${MILA}/offerings`, tokens['anna.ivanova']!);
    expect(body.offerings.find((offering) => offering.id === MUSEUM)).toMatchObject({
      kind: 'trip',
      consent: { given: false },
    });
    const mila = await trips();
    expect(mila.canConsent).toBe(true);
    const trip = mila.trips.find((t) => t.offeringId === MUSEUM)!;
    expect(trip).toMatchObject({ name: 'Museum visit, School A', permission: null, booking: null });
    expect(trip.consent!.wording).toContain('I give permission');
  });

  it('refuses to book the trip without permission', async () => {
    const response = await fetch(`${API}/checkout`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${tokens['anna.ivanova']}`,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({ items: [{ studentId: MILA, offeringId: MUSEUM }] }),
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { message: string }).message).toBe(
      "Museum visit, School A needs a guardian's permission for Mila first",
    );
  });

  it('takes permission only when Anna agrees to the wording and gives a contact', async () => {
    const trip = await museum();
    const path = `/students/${MILA}/trips/${trip.sessionId}/permission`;
    const policyVersionId = trip.consent!.policyVersionId;
    expect((await post(tokens['anna.ivanova']!, path, { policyVersionId, ...contact })).status).toBe(400);
    expect(
      (
        await post(tokens['anna.ivanova']!, path, {
          policyVersionId,
          agree: true,
          ...contact,
          emergencyContactPhone: 'x',
        })
      ).status,
    ).toBe(400);
    expect(
      (await post(tokens['hristo.georgiev']!, path, { policyVersionId, agree: true, ...contact })).status,
    ).toBe(403);
    const given = await post<{ permissionId: string }>(tokens['anna.ivanova']!, path, {
      policyVersionId,
      agree: true,
      ...contact,
    });
    expect(given.status).toBe(201);
    expect(
      (await post(tokens['anna.ivanova']!, path, { policyVersionId, agree: true, ...contact })).status,
    ).toBe(409);
    expect((await museum()).permission).toMatchObject({
      givenByMe: true,
      channel: 'family_portal',
      forCurrentWording: true,
    });
  });
});

describe('the participant list and withdrawal', () => {
  beforeAll(async () => {
    const anna = tokens['anna.ivanova']!;
    await payAndWait(anna, await placeOrder(anna, [{ studentId: MILA, offeringId: MUSEUM }]));
  });

  it("lists Mila for School Life with Anna's permission, the contact and her allergy", async () => {
    const { body } = await get<TripParticipants>('/school-life/trips?days=31', tokens.schoollife!);
    const trip = body.trips.find((t) => t.name === 'Museum visit, School A')!;
    expect(trip.booked).toBeGreaterThanOrEqual(1);
    expect(trip.participants.find((p) => p.studentName === 'Mila Ivanova')).toMatchObject({
      classLabel: '3A',
      status: 'confirmed',
      permission: { channel: 'family_portal', givenBy: 'Anna Ivanova' },
      emergencyContact: { name: 'Grandma Ivanova (synthetic)', phone: '+359 88 123 4567' },
      dietary: [expect.objectContaining({ kind: 'allergy', severity: 'life_threatening' })],
    });
  });

  it('gives the CEO the list without health data, and keeps parents out', async () => {
    const { body } = await get<TripParticipants>('/school-life/trips?days=31', tokens.ceo!);
    const trip = body.trips.find((t) => t.name === 'Museum visit, School A')!;
    expect(trip.participants.every((p) => p.dietary.length === 0)).toBe(true);
    expect((await get('/school-life/trips', tokens['hristo.georgiev']!)).status).toBe(403);
  });

  it('cancels the place and credits the payment when Anna withdraws', async () => {
    const before = (await credits()).length;
    const permission = (await museum()).permission!;
    const withdrawn = await post<{ outcome: string }>(
      tokens['anna.ivanova']!,
      `/students/${MILA}/trips/permissions/${permission.id}/withdraw`,
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.outcome).toBe('withdrawn_and_cancelled');
    expect(await museum()).toMatchObject({ permission: null, booking: null });

    const deadline = Date.now() + 15_000;
    let mine = await credits();
    while (mine.length === before && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      mine = await credits();
    }
    expect(mine).toHaveLength(before + 1);
    expect(mine.at(-1)).toMatchObject({ original_amount_minor: '1500' });
    expect(mine.at(-1)!.reason).toBe('Trip permission withdrawn: Museum visit, School A (1 session)');
    expect(
      (await post(tokens['anna.ivanova']!, `/students/${MILA}/trips/permissions/${permission.id}/withdraw`))
        .status,
    ).toBe(409);
  });

  it('waits with a withdrawal while a payment for the trip is open', async () => {
    const trip = await museum();
    const anna = tokens['anna.ivanova']!;
    const given = await post<{ permissionId: string }>(
      anna,
      `/students/${MILA}/trips/${trip.sessionId}/permission`,
      {
        policyVersionId: trip.consent!.policyVersionId,
        agree: true,
        ...contact,
      },
    );
    await placeOrder(anna, [{ studentId: MILA, offeringId: MUSEUM }]);
    const refused = await post(
      anna,
      `/students/${MILA}/trips/permissions/${given.body.permissionId}/withdraw`,
    );
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('a payment for this trip is still open');
  });
});

describe('the wording and paper permissions', () => {
  it('lets the administrator change the wording; permission must then be given again', async () => {
    expect(
      (
        await send('PUT', 'principal.a', `/admin/schools/${SCHOOL_A}/offerings/${MUSEUM}/trip-consent`, {
          text: 'short',
        })
      ).status,
    ).toBe(400);
    const changed = await send<{ version: number }>(
      'PUT',
      'admin',
      `/admin/schools/${SCHOOL_A}/offerings/${MUSEUM}/trip-consent`,
      { text: 'New wording for the integration test: the visit includes a picnic in the park.' },
    );
    expect(changed.status).toBe(200);
    expect(changed.body.version).toBeGreaterThanOrEqual(2);
    const trip = await museum();
    expect(trip.consent!.wording).toContain('picnic');
    expect(trip.permission).toMatchObject({ forCurrentWording: false });
  });

  it('lets the principal record a permission Anna gave on paper', async () => {
    const trip = await museum();
    const response = await post<{ permissionId: string }>(
      tokens['principal.a']!,
      `/school-life/trips/${trip.sessionId}/permissions`,
      {
        studentId: MILA,
        guardianPersonId: ANNA,
        channel: 'paper',
        policyVersionId: trip.consent!.policyVersionId,
        ...contact,
      },
    );
    // Anna's earlier permission is still live (for the old wording), so the school records nothing twice.
    expect(response.status).toBe(409);
    expect(
      (
        await post(tokens['kitchen.a']!, `/school-life/trips/${trip.sessionId}/permissions`, {
          studentId: MILA,
          guardianPersonId: ANNA,
          channel: 'paper',
          policyVersionId: trip.consent!.policyVersionId,
          ...contact,
        })
      ).status,
    ).toBe(403);
  });
});
