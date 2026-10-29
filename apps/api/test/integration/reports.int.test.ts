import { type RevenueReport } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { BORIS, get, MILA, offeringsOf, payAndWait, placeOrder, tokenFor } from './helpers';

// CEO reporting against the real stack: a purchase paid on the development
// provider shows up as test-mode money at the right schools, never as live
// revenue, and each role sees only the schools it may report on.

const tokens: Record<string, string> = {};
let today: string;
let before: RevenueReport;
let lunchA: number;
let lunchC: number;

const report = (user: string, query = '') => get<RevenueReport>(`/reports/revenue${query}`, tokens[user]!);
const school = (data: RevenueReport, name: string) => data.schools.find((row) => row.school.name === name)!;

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'ceo', 'principal.a', 'teacher.b', 'kitchen.a']) {
    tokens[user] = await tokenFor(user);
  }
  today = (await report('ceo')).body.to;
  before = (await report('ceo', `?from=${today}&to=${today}`)).body;

  const anna = tokens['anna.ivanova']!;
  const mila = await offeringsOf(anna, MILA);
  const boris = await offeringsOf(anna, BORIS);
  lunchA = mila.lunch.price.unitAmountMinor;
  lunchC = boris.lunch.price.unitAmountMinor;
  const placed = await placeOrder(anna, [
    {
      studentId: MILA,
      offeringId: mila.lunch.id,
      sessionIds: [mila.lunch.sessions.find((s) => !s.alreadyBooked)!.id],
    },
    {
      studentId: BORIS,
      offeringId: boris.lunch.id,
      sessionIds: [boris.lunch.sessions.find((s) => !s.alreadyBooked)!.id],
    },
  ]);
  await payAndWait(anna, placed);
});

describe('revenue per school', () => {
  it("shows the CEO today's development payment as test money at School A and School C", async () => {
    const { status, body } = await report('ceo', `?from=${today}&to=${today}`);
    expect(status).toBe(200);
    expect(body.schools.map((row) => row.school.name)).toEqual(['School A', 'School B', 'School C']);
    expect(school(body, 'School A').test.receivedMinor).toBe(
      school(before, 'School A').test.receivedMinor + lunchA,
    );
    expect(school(body, 'School C').test.receivedMinor).toBe(
      school(before, 'School C').test.receivedMinor + lunchC,
    );
    expect(school(body, 'School B').test.receivedMinor).toBe(school(before, 'School B').test.receivedMinor);
    // Nothing from the development provider is ever live revenue.
    expect(body.totals.every((total) => total.live.netMinor === 0)).toBe(true);
    expect(body.totals[0]!.test.netMinor).toBe(before.totals[0]!.test.netMinor + lunchA + lunchC);
  });

  it('defaults to this month so far', async () => {
    const { body } = await report('ceo');
    expect(body.from).toBe(`${today.slice(0, 8)}01`);
    expect(body.to).toBe(today);
    expect(school(body, 'School A').test.receivedMinor).toBeGreaterThanOrEqual(lunchA);
  });

  it('shows a principal only their own school', async () => {
    const { body } = await report('principal.a', `?from=${today}&to=${today}`);
    expect(body.schools.map((row) => row.school.name)).toEqual(['School A']);
    expect(body.schools[0]!.test.receivedMinor).toBe(school(before, 'School A').test.receivedMinor + lunchA);
  });

  it('is closed to parents, teachers and the kitchen', async () => {
    for (const user of ['anna.ivanova', 'teacher.b', 'kitchen.a']) {
      expect((await report(user)).status).toBe(403);
    }
  });

  it('checks the period', async () => {
    expect((await report('ceo', '?from=2026-10-01')).status).toBe(400);
    expect((await report('ceo', '?from=2026-10-31&to=2026-10-01')).status).toBe(400);
    expect((await report('ceo', '?from=2025-01-01&to=2026-12-31')).status).toBe(400);
    expect((await report('ceo', '?from=2026-13-01&to=2026-13-02')).status).toBe(400);
  });
});
