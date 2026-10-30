import { type ActivityRegisters, type KitchenCounts } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { BORIS, get, MILA, offeringsOf, payAndWait, placeOrder, tokenFor } from './helpers';

// School Life views against the real stack: Anna buys lunch for Mila (School A)
// and Boris (School C) on one day and the chess club for Mila; each staff role
// then sees exactly what its permissions allow.

const tokens: Record<string, string> = {};
let day: string;
let chessDay: string;
let before: KitchenCounts;

const kitchen = (user: string, query: string) =>
  get<KitchenCounts>(`/school-life/kitchen?${query}`, tokens[user]!);
const registers = (user: string, query: string) =>
  get<ActivityRegisters>(`/school-life/registers?${query}`, tokens[user]!);
const schoolDay = (counts: KitchenCounts, school: string) =>
  counts.schools.find((entry) => entry.school.name === school)?.days.find((entry) => entry.date === day);

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'schoollife', 'kitchen.a', 'ceo', 'teacher.b']) {
    tokens[user] = await tokenFor(user);
  }
  const anna = tokens['anna.ivanova']!;
  const mila = await offeringsOf(anna, MILA);
  const boris = await offeringsOf(anna, BORIS);
  // A day both schools serve lunch and neither child has booked yet.
  const borisDays = new Map(
    boris.lunch.sessions.filter((s) => !s.alreadyBooked).map((s) => [s.serviceDate, s.id]),
  );
  const shared = mila.lunch.sessions.find((s) => !s.alreadyBooked && borisDays.has(s.serviceDate))!;
  day = shared.serviceDate!;
  chessDay = mila.activity.sessions[0]!.startsAt!.slice(0, 10);

  before = (await kitchen('schoollife', `from=${day}&days=1`)).body;
  const placed = await placeOrder(anna, [
    { studentId: MILA, offeringId: mila.lunch.id, sessionIds: [shared.id] },
    { studentId: BORIS, offeringId: boris.lunch.id, sessionIds: [borisDays.get(day)] },
    ...(mila.activity.sessions.some((s) => s.alreadyBooked)
      ? []
      : [{ studentId: MILA, offeringId: mila.activity.id }]),
  ]);
  await payAndWait(anna, placed);
});

describe('kitchen counts', () => {
  it('counts the paid lunches at both schools for the School Life coordinator, with dietary needs', async () => {
    const { status, body } = await kitchen('schoollife', `from=${day}&days=1`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ from: day, days: 1 });
    expect(schoolDay(body, 'School A')!.meals).toBe(schoolDay(before, 'School A')!.meals + 1);
    expect(schoolDay(body, 'School C')!.meals).toBe(schoolDay(before, 'School C')!.meals + 1);
    expect(body.schools.map((entry) => entry.school.name)).toEqual(
      expect.arrayContaining(['School A', 'School B', 'School C']),
    );
    expect(body.schools.every((entry) => entry.showsDietary)).toBe(true);
    expect(schoolDay(body, 'School A')!.dietary).toContainEqual({
      studentName: 'Mila Ivanova',
      classLabel: '3A',
      kind: 'allergy',
      severity: 'life_threatening',
      description: 'Peanuts (synthetic example)',
    });
  });

  it("shows the School A kitchen only School A, with its children's dietary needs", async () => {
    const { body } = await kitchen('kitchen.a', `from=${day}&days=1`);
    expect(body.schools.map((entry) => entry.school.name)).toEqual(['School A']);
    const today = schoolDay(body, 'School A')!;
    expect(today.meals).toBe(schoolDay(before, 'School A')!.meals + 1);
    expect(today.dietary.map((entry) => entry.studentName)).toContain('Mila Ivanova');
  });

  it('gives the CEO the counts but no health data', async () => {
    const { body } = await kitchen('ceo', `from=${day}&days=1`);
    expect(body.schools.length).toBeGreaterThanOrEqual(3);
    expect(
      body.schools.every((entry) => !entry.showsDietary && entry.days.every((d) => d.dietary.length === 0)),
    ).toBe(true);
    expect(schoolDay(body, 'School A')!.meals).toBe(schoolDay(before, 'School A')!.meals + 1);
  });

  it('keeps unpaid reservations apart from the meals to cook', async () => {
    const anna = tokens['anna.ivanova']!;
    const { lunch } = await offeringsOf(anna, BORIS);
    const open = lunch.sessions.find((s) => !s.alreadyBooked && s.serviceDate !== day)!;
    const query = `from=${open.serviceDate}&days=1`;
    const ahead = (await kitchen('schoollife', query)).body;
    await placeOrder(anna, [{ studentId: BORIS, offeringId: lunch.id, sessionIds: [open.id] }]);
    const after = (await kitchen('schoollife', query)).body;
    const at = (counts: KitchenCounts) => counts.schools.find((s) => s.school.name === 'School C')!.days[0]!;
    expect(at(after).meals).toBe(at(ahead).meals);
    expect(at(after).awaitingPayment).toBe(at(ahead).awaitingPayment + 1);
  });

  it('is closed to parents and checks its parameters', async () => {
    expect((await kitchen('anna.ivanova', `from=${day}`)).status).toBe(403);
    expect((await kitchen('schoollife', 'days=40')).status).toBe(400);
    expect((await kitchen('schoollife', 'from=29-10-2026')).status).toBe(400);
    const defaults = await kitchen('schoollife', '');
    expect(defaults.status).toBe(200);
    expect(defaults.body.days).toBe(5);
  });
});

describe('activity registers', () => {
  it('lists Mila on the chess club register, with her class', async () => {
    const { status, body } = await registers('schoollife', `from=${chessDay}&days=1`);
    expect(status).toBe(200);
    const chess = body.sessions.find((session) => session.offering.name === 'Chess club, School A')!;
    expect(chess).toMatchObject({ location: 'Room 12', capacity: 12 });
    expect(chess.booked).toBeGreaterThanOrEqual(1);
    expect(chess.attendees).toContainEqual({
      studentName: 'Mila Ivanova',
      classLabel: '3A',
      status: 'confirmed',
    });
  });

  it("shows a School B teacher no other school's register", async () => {
    const { body } = await registers('teacher.b', `from=${chessDay}&days=7`);
    expect(body.sessions.every((session) => session.school.name === 'School B')).toBe(true);
  });
});
