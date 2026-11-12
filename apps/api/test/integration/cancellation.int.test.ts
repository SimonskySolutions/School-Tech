import {
  type CancelBookingResponse,
  type CheckoutGroupView,
  type KitchenCounts,
  type LunchList,
  type RevenueReport,
} from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemDatabase } from '../../src/database/system-database';
import { issueCancellationCredit } from '../../src/worker/cancellation-credit';
import { API, BORIS, get, MILA, offeringsOf, payAndWait, placeOrder, secret, tokenFor } from './helpers';

// Authorised cancellation against the real stack: School Life cancels one of
// Mila's paid lunch days; the worker credits Anna with exactly that day's
// price; the club booking, Boris's lunch and the enrolments do not change; the
// kitchen count and the CEO's figures follow.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const ANNA = 'c1000000-0000-7000-8000-000000000020';

const tokens: Record<string, string> = {};
let worker: Client;
let system: SystemDatabase;
let day: string;
let price: number;
let groupId: string;
let milaBooking: string;
let lineId: string;
let reportBefore: RevenueReport;
let kitchenBefore: number;

const cancel = (user: string, bookingId: string, body: unknown = { reason: 'Absent: school trip' }) =>
  fetch(`${API}/school-life/bookings/${bookingId}/cancel`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tokens[user]!}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const today = async () => (await get<RevenueReport>('/reports/revenue', tokens.ceo!)).body.to;
const meals = async () => {
  const { body } = await get<KitchenCounts>(`/school-life/kitchen?from=${day}&days=1`, tokens.schoollife!);
  return body.schools.find((school) => school.school.id === SCHOOL_A)!.days[0]!.meals;
};

async function creditFor(line: string) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const { rows } = await worker.query<{
      id: string;
      holder_person_id: string;
      remaining_amount_minor: string;
      billing_entity_id: string;
    }>(
      'SELECT id, holder_person_id, remaining_amount_minor, billing_entity_id FROM commerce.account_credit WHERE source_order_line_id = $1',
      [line],
    );
    if (rows[0]) return rows[0];
    if (Date.now() > deadline) throw new Error('no credit was issued');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'schoollife', 'kitchen.a', 'teacher.b', 'ceo']) {
    tokens[user] = await tokenFor(user);
  }
  worker = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_worker',
    password: secret('pg_worker_password'),
  });
  await worker.connect();
  system = new SystemDatabase({
    host: 'postgres',
    port: 5432,
    database: 'pythagoras',
    user: 'pyth_worker',
    password: secret('pg_worker_password'),
    max: 1,
  });

  const anna = tokens['anna.ivanova']!;
  const mila = await offeringsOf(anna, MILA);
  const boris = await offeringsOf(anna, BORIS);
  const borisDays = new Map(
    boris.lunch.sessions.filter((s) => !s.alreadyBooked).map((s) => [s.serviceDate, s.id]),
  );
  const shared = mila.lunch.sessions.find((s) => !s.alreadyBooked && borisDays.has(s.serviceDate))!;
  day = shared.serviceDate!;
  price = mila.lunch.price.unitAmountMinor;
  const placed = await placeOrder(anna, [
    { studentId: MILA, offeringId: mila.lunch.id, sessionIds: [shared.id] },
    { studentId: BORIS, offeringId: boris.lunch.id, sessionIds: [borisDays.get(day)] },
  ]);
  groupId = placed.checkoutGroupId;
  await payAndWait(anna, placed);

  const list = (
    await get<LunchList>(`/school-life/lunch?schoolId=${SCHOOL_A}&date=${day}`, tokens.schoollife!)
  ).body;
  milaBooking = list.bookings.find(
    (booking) => booking.studentName === 'Mila Ivanova' && booking.status === 'confirmed',
  )!.bookingId;
  const { rows } = await worker.query<{ order_line_id: string }>(
    'SELECT order_line_id FROM scheduling.booking WHERE id = $1',
    [milaBooking],
  );
  lineId = rows[0]!.order_line_id;
  reportBefore = (
    await get<RevenueReport>(`/reports/revenue?from=${await today()}&to=${await today()}`, tokens.ceo!)
  ).body;
  kitchenBefore = await meals();
});

afterAll(async () => {
  await Promise.all([worker.end(), system.close()]);
});

describe('who may cancel', () => {
  it('lists the day for School Life with cancelling allowed', async () => {
    const { status, body } = await get<LunchList>(
      `/school-life/lunch?schoolId=${SCHOOL_A}&date=${day}`,
      tokens.schoollife!,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ school: { name: 'School A' }, date: day, canCancel: true });
  });

  it('refuses the kitchen, another school and the parent', async () => {
    expect((await cancel('kitchen.a', milaBooking)).status).toBe(403);
    expect((await cancel('teacher.b', milaBooking)).status).toBe(404);
    expect([403, 404]).toContain((await cancel('anna.ivanova', milaBooking)).status);
    const kitchenList = await get<LunchList>(
      `/school-life/lunch?schoolId=${SCHOOL_A}&date=${day}`,
      tokens['kitchen.a']!,
    );
    expect(kitchenList.body.canCancel).toBe(false);
  });

  it('needs a reason', async () => {
    expect((await cancel('schoollife', milaBooking, {})).status).toBe(400);
    expect((await cancel('schoollife', milaBooking, { reason: ' ' })).status).toBe(400);
  });
});

describe('cancelling one lunch day', () => {
  it('cancels the day and credits exactly its price, with the same company', async () => {
    const response = await cancel('schoollife', milaBooking);
    expect(response.status).toBe(200);
    expect((await response.json()) as CancelBookingResponse).toEqual({
      bookingId: milaBooking,
      status: 'cancelled',
      creditAmountMinor: price,
      currency: 'EUR',
    });

    const credit = await creditFor(lineId);
    expect(credit.holder_person_id).toBe(ANNA);
    expect(Number(credit.remaining_amount_minor)).toBe(price);
    const { rows: order } = await worker.query<{ billing_entity_id: string }>(
      'SELECT o.billing_entity_id FROM commerce.order_line l JOIN commerce.customer_order o ON o.id = l.order_id WHERE l.id = $1',
      [lineId],
    );
    expect(credit.billing_entity_id).toBe(order[0]!.billing_entity_id);
    const { rows: ledger } = await worker.query<{ kind: string; amount_minor: string }>(
      'SELECT kind, amount_minor FROM commerce.payment_allocation WHERE order_line_id = $1 ORDER BY allocated_at, kind DESC',
      [lineId],
    );
    expect(ledger).toEqual([
      { kind: 'payment', amount_minor: String(price) },
      { kind: 'credit_issued', amount_minor: String(-price) },
    ]);
  });

  it('changes nothing else: Boris keeps his lunch, the enrolments stay, the order stays paid', async () => {
    const { body } = await get<CheckoutGroupView>(`/checkout-groups/${groupId}`, tokens['anna.ivanova']!);
    expect(body.orders[0]!.status).toBe('paid');
    expect(body.orders[0]!.lines.map((line) => [line.studentName, line.status])).toEqual([
      ['Mila', 'cancelled'],
      ['Boris', 'confirmed'],
    ]);
    const { rows } = await worker.query<{ status: string }>(
      `SELECT DISTINCT status FROM people.enrolment WHERE student_person_id = ANY ($1::uuid[])`,
      [[MILA, BORIS]],
    );
    expect(rows).toEqual([{ status: 'active' }]);
    const { rows: clubs } = await worker.query<{ count: string }>(
      `SELECT count(*) FROM scheduling.booking b JOIN scheduling.session s ON s.id = b.session_id
         JOIN catalog.school_offering o ON o.id = s.offering_id
        WHERE b.student_person_id = $1 AND o.code = 'chess' AND b.status = 'cancelled'`,
      [MILA],
    );
    expect(clubs[0]!.count).toBe('0');
  });

  it('takes the meal off the kitchen count and lists the cancellation', async () => {
    expect(await meals()).toBe(kitchenBefore - 1);
    const { body } = await get<LunchList>(
      `/school-life/lunch?schoolId=${SCHOOL_A}&date=${day}`,
      tokens.schoollife!,
    );
    expect(body.bookings.find((booking) => booking.bookingId === milaBooking)!.status).toBe('cancelled');
  });

  it("updates the CEO's figures: credited and credit owed rise, net falls", async () => {
    const date = await today();
    const after = (await get<RevenueReport>(`/reports/revenue?from=${date}&to=${date}`, tokens.ceo!)).body;
    const a = (report: RevenueReport) => report.schools.find((school) => school.school.id === SCHOOL_A)!;
    expect(a(after).test.creditedMinor).toBe(a(reportBefore).test.creditedMinor + price);
    expect(a(after).test.netMinor).toBe(a(reportBefore).test.netMinor - price);
    expect(a(after).creditOwed.testMinor).toBe(a(reportBefore).creditOwed.testMinor + price);
    expect(after.totals[0]!.live.netMinor).toBe(0);
  });

  it('cannot be done twice, and a repeated event issues no second credit', async () => {
    expect((await cancel('schoollife', milaBooking)).status).toBe(409);
    expect(await system.withSystem('worker:test', (tx) => issueCancellationCredit(tx, lineId))).toBe(
      'already-credited',
    );
    const { rows } = await worker.query<{ count: string }>(
      'SELECT count(*) FROM commerce.account_credit WHERE source_order_line_id = $1',
      [lineId],
    );
    expect(rows[0]!.count).toBe('1');
  });
});
