import { type SchoolLifeDay } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { get, MILA, offeringsOf, tokenFor } from './helpers';

// The School Life day (M4.8) against the real stack: one school on one day,
// summarised from the services' own read models. Each role sees the parts its
// permissions allow and no other school's day. The full day's operation is
// the web end-to-end test.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const SCHOOL_C = 'b1000000-0000-7000-8000-00000000000c';

const tokens: Record<string, string> = {};
const schoolDay = (user: string, query: string) =>
  get<SchoolLifeDay>(`/school-life/day?${query}`, tokens[user]!);
let lunchDay: string;
let busDay: string;

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'schoollife', 'principal.c', 'kitchen.a', 'ceo']) {
    tokens[user] = await tokenFor(user);
  }
  const mila = await offeringsOf(tokens['anna.ivanova']!, MILA);
  lunchDay = mila.lunch.sessions[0]!.serviceDate!;
  // A weekday inside the seeded bus term (two weeks from now for about three months).
  const day = new Date(Date.now() + 21 * 86_400_000);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day.setUTCDate(day.getUTCDate() + 1);
  busDay = day.toISOString().slice(0, 10);
});

describe('the School Life day', () => {
  it('shows School Life today at School A, with every part it handles', async () => {
    const { status, body } = await schoolDay('schoollife', `schoolId=${SCHOOL_A}`);
    expect(status).toBe(200);
    expect(body.school).toMatchObject({ id: SCHOOL_A, name: 'School A' });
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.schools.map((school) => school.name)).toEqual(
      expect.arrayContaining(['School A', 'School C']),
    );
    expect(body.requests).not.toBeNull();
    expect(body.uniforms).not.toBeNull();
    expect(body.uniforms!.lowStock).toBeGreaterThan(0);
    expect(typeof body.dietaryToVerify).toBe('number');
  });

  it('shows the lunch, and the bus on a school day of its term', async () => {
    const lunch = (await schoolDay('schoollife', `schoolId=${SCHOOL_A}&date=${lunchDay}`)).body;
    expect(lunch.date).toBe(lunchDay);
    expect(lunch.lunch).toMatchObject({ showsDietary: true });
    expect(typeof lunch.lunch!.meals).toBe('number');
    expect(lunch.lunch!.dishes).toBeGreaterThan(0);
    const bus = (await schoolDay('schoollife', `schoolId=${SCHOOL_A}&date=${busDay}`)).body;
    expect(bus.transport).toEqual([
      expect.objectContaining({ name: 'School bus, route 1, School A', seats: 20, firstPickup: '07:20' }),
    ]);
  });

  it('shows the kitchen no requests and no count of unverified needs', async () => {
    const { status, body } = await schoolDay('kitchen.a', `schoolId=${SCHOOL_A}`);
    expect(status).toBe(200);
    expect(body.requests).toBeNull();
    expect(body.dietaryToVerify).toBeNull();
    expect(body.schools.map((school) => school.name)).toEqual(['School A']);
    // Without a school named, the day opens at the viewer's first school.
    expect((await schoolDay('kitchen.a', '')).body.school.name).toBe('School A');
  });

  it('shows the CEO the day but not the families’ requests', async () => {
    const { body } = await schoolDay('ceo', `schoolId=${SCHOOL_A}`);
    expect(body.school.name).toBe('School A');
    expect(body.requests).toBeNull();
  });

  it('shows no one a school they do not work at, nor parents any school', async () => {
    expect((await schoolDay('principal.c', `schoolId=${SCHOOL_A}`)).status).toBe(404);
    expect((await schoolDay('kitchen.a', `schoolId=${SCHOOL_C}`)).status).toBe(404);
    expect((await schoolDay('anna.ivanova', `schoolId=${SCHOOL_A}`)).status).toBe(404);
    expect((await schoolDay('anna.ivanova', '')).status).toBe(404);
    expect((await schoolDay('schoollife', `schoolId=${SCHOOL_A}&date=tomorrow`)).status).toBe(400);
  });
});
