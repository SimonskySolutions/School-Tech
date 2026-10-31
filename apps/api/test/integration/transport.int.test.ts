import { type SchoolTransport, type StudentOfferings, type TransportRuns } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, MILA, payAndWait, post, tokenFor } from './helpers';

// Transport (M4.5) against the real stack. The seed has route 1 to School A on
// school days, three stops and 20 seats for a term starting two weeks after
// seeding. Anna buys Mila a seat from the second stop; the driver's list shows
// her there. The race for a last seat between two families is in the
// database concurrency test; here two requests for the same child race.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const BUS = 'd2000000-0000-7000-8000-0000000000a8';
const STOP_2 = 'd5000000-0000-7000-8000-0000000000a2';

const tokens: Record<string, string> = {};
const checkout = (items: unknown[]) =>
  fetch(`${API}/checkout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens['anna.ivanova']}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ items }),
  });

/** A school day of the term, in the school's time zone. */
function termDay(startsAt: string): string {
  const day = new Date(Date.parse(startsAt) + 6 * 3_600_000);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'schoollife', 'kitchen.a', 'teacher.b', 'principal.a', 'admin']) {
    tokens[user] = await tokenFor(user);
  }
});

describe('buying a seat', () => {
  it('shows Anna the route with its stops for Mila', async () => {
    const { body } = await get<StudentOfferings>(`/students/${MILA}/offerings`, tokens['anna.ivanova']!);
    const bus = body.offerings.find((offering) => offering.id === BUS)!;
    expect(bus).toMatchObject({ kind: 'transport', price: { unitAmountMinor: 9000, unit: 'per_term' } });
    expect(bus.sessions).toHaveLength(1);
    expect(bus.route!.stops.map((stop) => stop.name)).toEqual([
      'Mladost metro station (synthetic)',
      'Druzhba park, north gate (synthetic)',
      'Iztok, bus shelter 4 (synthetic)',
    ]);
    expect(bus.route!.stops[1]).toMatchObject({ pickupTime: '07:35', dropoffTime: '16:25' });
  });

  it('refuses a seat without a stop', async () => {
    const response = await checkout([{ studentId: MILA, offeringId: BUS }]);
    expect(response.status).toBe(422);
    expect(((await response.json()) as { message: string }).message).toBe(
      'choose a stop for School bus, route 1, School A',
    );
  });

  it('gives exactly one of two simultaneous requests the seat, and books it from the chosen stop', async () => {
    const results = await Promise.all([
      checkout([{ studentId: MILA, offeringId: BUS, stopId: STOP_2 }]),
      checkout([{ studentId: MILA, offeringId: BUS, stopId: STOP_2 }]),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBeGreaterThanOrEqual(409);
    const winner = results.find((r) => r.status === 201)!;
    const placed = (await winner.json()) as Parameters<typeof payAndWait>[1];
    await payAndWait(tokens['anna.ivanova']!, placed);
    const { body } = await get<StudentOfferings>(`/students/${MILA}/offerings`, tokens['anna.ivanova']!);
    expect(body.offerings.find((offering) => offering.id === BUS)!.sessions[0]!.alreadyBooked).toBe(true);
  });
});

describe('the driver’s list and the routes for staff', () => {
  let day: string;

  beforeAll(async () => {
    const { body } = await get<SchoolTransport>(`/schools/${SCHOOL_A}/transport`, tokens.schoollife!);
    day = termDay(body.offerings.find((o) => o.id === BUS)!.terms[0]!.startsAt);
  });

  it('lists Mila at her stop on a school day of the term, stops in order', async () => {
    const { status, body } = await get<TransportRuns>(
      `/school-life/transport?date=${day}`,
      tokens.schoollife!,
    );
    expect(status).toBe(200);
    const route = body.routes.find((r) => r.name === 'School bus, route 1, School A')!;
    expect(route).toMatchObject({
      vehicle: 'Minibus CA 0000 XX (synthetic)',
      seats: 20,
      term: 'Spring term',
    });
    expect(route.stops.map((stop) => stop.name)[0]).toBe('Mladost metro station (synthetic)');
    expect(route.stops.find((stop) => stop.name.startsWith('Druzhba'))!.children).toContainEqual({
      studentName: 'Mila Ivanova',
      classLabel: '3A',
    });
  });

  it('shows no runs on a weekend, nothing for other schools, and keeps parents out', async () => {
    const saturday = new Date(`${day}T12:00:00Z`);
    while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() + 1);
    const weekend = await get<TransportRuns>(
      `/school-life/transport?date=${saturday.toISOString().slice(0, 10)}`,
      tokens.schoollife!,
    );
    expect(weekend.body.routes.find((r) => r.name === 'School bus, route 1, School A')).toBeUndefined();
    const teacher = await get<TransportRuns>(`/school-life/transport?date=${day}`, tokens['teacher.b']!);
    expect(teacher.body.routes.every((r) => r.school.name === 'School B')).toBe(true);
    expect((await get('/school-life/transport', tokens['anna.ivanova']!)).status).toBe(403);
  });

  it('shows staff the route, its stops and the seats taken; only catalogue managers add stops', async () => {
    const { body } = await get<SchoolTransport>(`/schools/${SCHOOL_A}/transport`, tokens['kitchen.a']!);
    expect(body.canManage).toBe(false);
    const bus = body.offerings.find((o) => o.id === BUS)!;
    expect(bus.terms[0]).toMatchObject({ seats: 20, label: 'Spring term' });
    expect(bus.terms[0]!.taken).toBeGreaterThanOrEqual(1);
    const stop = { name: 'Extra stop (integration test)', pickupTime: '07:50' };
    expect(
      (await post(tokens['kitchen.a']!, `/schools/${SCHOOL_A}/transport-routes/${BUS}/stops`, stop)).status,
    ).toBe(403);
    const added = await post<{ position: number }>(
      tokens['principal.a']!,
      `/schools/${SCHOOL_A}/transport-routes/${BUS}/stops`,
      stop,
    );
    expect(added.status).toBe(201);
    expect(added.body.position).toBeGreaterThanOrEqual(4);
    expect(
      (
        await post(tokens['principal.a']!, `/schools/${SCHOOL_A}/transport-routes`, {
          offeringId: BUS,
          weekdays: [1],
        })
      ).status,
    ).toBe(409);
  });

  it('gives a route one term only, and term calendars only to transport', async () => {
    const term = { capacity: 20, schedule: { type: 'term', from: '2027-02-01', to: '2027-06-30' } };
    const again = await post<{ message: string }>(tokens.admin!, `/admin/schools/${SCHOOL_A}/sessions`, {
      offeringId: BUS,
      ...term,
    });
    expect(again.status).toBe(422);
    expect(again.body.message).toBe('this route already has its term; add a new offering for the next term');
    const lunch = await get<StudentOfferings>(`/students/${MILA}/offerings`, tokens['anna.ivanova']!);
    const lunchId = lunch.body.offerings.find((o) => o.kind === 'lunch')!.id;
    expect(
      (await post(tokens.admin!, `/admin/schools/${SCHOOL_A}/sessions`, { offeringId: lunchId, ...term }))
        .status,
    ).toBe(422);
  });
});
