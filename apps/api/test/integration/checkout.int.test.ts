import { readFileSync } from 'node:fs';
import { type CheckoutGroupView, type CheckoutResponse, type StudentOfferings } from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SystemDatabase } from '../../src/database/system-database';
import { DEV_SIGNATURE_HEADER, DevelopmentPaymentProvider } from '../../src/payments/development-provider';
import { expireReservations } from '../../src/worker/reservations';

// Buying and paying against the real stack: API, worker, Keycloak and the
// seeded database, with the development payment provider. The test script
// clears earlier orders first (scripts/db-reset-commerce.sh).

const API = process.env.API_URL ?? 'http://api:3000';
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://keycloak:8080';
const secret = (name: string) => readFileSync(`/workspace/secrets/${name}`, 'utf8').trim();

const MILA = 'c1000000-0000-7000-8000-000000000030';
const BORIS = 'c1000000-0000-7000-8000-000000000031';
const KALINA = 'c1000000-0000-7000-8000-000000000032';

async function tokenFor(username: string): Promise<string> {
  const response = await fetch(`${KEYCLOAK}/realms/pythagoras/protocol/openid-connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: 'pythagoras-dev-tests',
      username: `${username}@pythagoras.test`,
      password: secret('keycloak_dev_user_password'),
    }),
  });
  if (!response.ok) throw new Error(`token for ${username}: ${response.status}`);
  return ((await response.json()) as { access_token: string }).access_token;
}

let anna: string;
let worker: Client;
let owner: Client;
let system: SystemDatabase;
const dev = new DevelopmentPaymentProvider({
  secret: secret('dev_payments_secret'),
  publicUrl: 'http://unused',
});

beforeAll(async () => {
  anna = await tokenFor('anna.ivanova');
  const connect = async (user: string, password: string) => {
    const client = new Client({ host: 'postgres', database: 'pythagoras', user, password });
    await client.connect();
    return client;
  };
  worker = await connect('pyth_worker', secret('pg_worker_password'));
  owner = await connect('pyth_migrator', secret('pg_migrator_password'));
  system = new SystemDatabase({
    host: 'postgres',
    port: 5432,
    database: 'pythagoras',
    user: 'pyth_worker',
    password: secret('pg_worker_password'),
    max: 1,
  });
});

afterAll(async () => {
  await Promise.all([worker.end(), owner.end(), system.close()]);
});

async function get<T>(path: string, token = anna): Promise<{ status: number; body: T }> {
  const response = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: response.status, body: (await response.json()) as T };
}

async function checkout(items: unknown[], key: string | null = crypto.randomUUID()) {
  const response = await fetch(`${API}/checkout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${anna}`,
      'content-type': 'application/json',
      ...(key ? { 'idempotency-key': key } : {}),
    },
    body: JSON.stringify({ items }),
  });
  return { status: response.status, body: (await response.json()) as CheckoutResponse };
}

/** The development checkout page lives on the API; the URL names its public host. */
const tokenOf = (checkoutUrl: string) => checkoutUrl.split('/dev-payments/checkout/')[1]!;

async function pay(checkoutUrl: string, outcome: 'succeed' | 'fail') {
  const response = await fetch(`${API}/dev-payments/checkout/${tokenOf(checkoutUrl)}/${outcome}`, {
    method: 'POST',
    redirect: 'manual',
  });
  return { status: response.status, location: response.headers.get('location') };
}

async function sendWebhook(body: string, signature: string) {
  const response = await fetch(`${API}/webhooks/development`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [DEV_SIGNATURE_HEADER]: signature },
    body,
  });
  return { status: response.status, body: (await response.json()) as { duplicate?: boolean } };
}

async function waitForOrder(groupId: string, done: (view: CheckoutGroupView) => boolean) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const { body } = await get<CheckoutGroupView>(`/checkout-groups/${groupId}`);
    if (done(body)) return body;
    if (Date.now() > deadline) throw new Error(`order did not settle: ${JSON.stringify(body.orders)}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function inboundStatus(eventId: string): Promise<string | undefined> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const { rows } = await worker.query<{ processing_status: string }>(
      'SELECT processing_status FROM integration.inbound_event WHERE provider_event_id = $1',
      [eventId],
    );
    const status = rows[0]?.processing_status;
    if (status && status !== 'received') return status;
    if (Date.now() > deadline) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function offeringsOf(studentId: string) {
  const { status, body } = await get<StudentOfferings>(`/students/${studentId}/offerings`);
  expect(status).toBe(200);
  const find = (kind: 'lunch' | 'activity') => body.offerings.find((offering) => offering.kind === kind)!;
  return { lunch: find('lunch'), activity: find('activity') };
}

const sessionsOf = (offering: {
  sessions: { id: string; available: number | null; alreadyBooked: boolean }[];
}) =>
  offering.sessions.filter((session) => !session.alreadyBooked && session.available !== 0).map((s) => s.id);

describe('what a parent can book', () => {
  it("lists each child's lunch and clubs at the child's own school, with prices", async () => {
    const mila = await offeringsOf(MILA);
    expect(mila.lunch).toMatchObject({
      name: 'Lunch at School A',
      pickSessions: true,
      price: { unitAmountMinor: 450, currency: 'EUR' },
      billingEntity: { name: 'Testing Company' },
    });
    expect(mila.activity).toMatchObject({ name: 'Chess club, School A', pickSessions: false });
    expect(mila.lunch.sessions.length).toBeGreaterThan(5);
    const boris = await offeringsOf(BORIS);
    expect(boris.lunch.school.name).not.toBe(mila.lunch.school.name);
  });

  it("shows nothing for another family's child", async () => {
    expect((await get(`/students/${KALINA}/offerings`)).status).toBe(404);
  });
});

describe('checkout and payment confirmation', () => {
  it('needs an Idempotency-Key', async () => {
    const { lunch } = await offeringsOf(MILA);
    const { status } = await checkout(
      [{ studentId: MILA, offeringId: lunch.id, sessionIds: sessionsOf(lunch).slice(0, 1) }],
      null,
    );
    expect(status).toBe(400);
  });

  it("refuses to book for another family's child", async () => {
    const { lunch } = await offeringsOf(MILA);
    const { status } = await checkout([
      { studentId: KALINA, offeringId: lunch.id, sessionIds: sessionsOf(lunch).slice(0, 1) },
    ]);
    expect([403, 404]).toContain(status);
  });

  it('Anna buys lunch for both children and a club for one; the worker confirms the payment', async () => {
    const mila = await offeringsOf(MILA);
    const boris = await offeringsOf(BORIS);
    const items = [
      { studentId: MILA, offeringId: mila.lunch.id, sessionIds: sessionsOf(mila.lunch).slice(0, 2) },
      { studentId: BORIS, offeringId: boris.lunch.id, sessionIds: sessionsOf(boris.lunch).slice(0, 1) },
      { studentId: MILA, offeringId: mila.activity.id },
    ];
    const key = crypto.randomUUID();
    const placed = await checkout(items, key);
    expect(placed.status).toBe(201);
    // One company bills all three schools, so one order and one payment.
    expect(placed.body.orders).toHaveLength(1);
    const [order] = placed.body.orders;
    expect(order).toMatchObject({
      billingEntityName: 'Testing Company',
      totalMinor: 2 * 450 + 500 + 6000,
      currency: 'EUR',
    });
    expect(order!.checkoutUrl).toContain('/dev-payments/checkout/');

    // A retry with the same key returns the same checkout, not a second order.
    const again = await checkout(items, key);
    expect(again.body.checkoutGroupId).toBe(placed.body.checkoutGroupId);
    expect(again.body.orders[0]!.orderId).toBe(order!.orderId);
    expect(again.body.orders[0]!.checkoutUrl).toBe(order!.checkoutUrl);

    const pending = await get<CheckoutGroupView>(`/checkout-groups/${placed.body.checkoutGroupId}`);
    expect(pending.body.orders[0]).toMatchObject({
      status: 'pending_payment',
      payment: { status: 'pending', provider: 'development', mode: 'test' },
      checkoutUrl: order!.checkoutUrl,
    });
    expect(pending.body.orders[0]!.lines).toHaveLength(4);

    // The test checkout page says plainly that no money moves.
    const page = await fetch(`${API}/dev-payments/checkout/${tokenOf(order!.checkoutUrl!)}`);
    expect(await page.text()).toContain('No money moves');

    // The redirect back proves nothing; the order is paid only when the worker says so.
    const back = await pay(order!.checkoutUrl!, 'succeed');
    expect(back.status).toBe(303);
    expect(back.location).toContain(`/orders/${placed.body.checkoutGroupId}?returned=1`);

    const paid = await waitForOrder(placed.body.checkoutGroupId, (view) => view.orders[0]!.status === 'paid');
    expect(paid.orders[0]!.payment!.status).toBe('succeeded');
    expect(paid.orders[0]!.checkoutUrl).toBeNull();
    expect(paid.orders[0]!.lines.every((line) => line.status === 'confirmed')).toBe(true);

    const { rows: allocated } = await worker.query<{ total: string; count: string }>(
      `SELECT sum(a.amount_minor) AS total, count(*) AS count FROM commerce.payment_allocation a
         JOIN commerce.order_line l ON l.id = a.order_line_id WHERE l.order_id = $1`,
      [order!.orderId],
    );
    expect(allocated[0]).toEqual({ total: String(order!.totalMinor), count: '4' });
    const { rows: bookings } = await worker.query<{ status: string }>(
      `SELECT DISTINCT b.status FROM scheduling.booking b JOIN commerce.order_line l ON l.id = b.order_line_id
        WHERE l.order_id = $1`,
      [order!.orderId],
    );
    expect(bookings).toEqual([{ status: 'confirmed' }]);
  });

  it('applies a duplicate webhook once and ignores an older, out-of-order event', async () => {
    const { lunch } = await offeringsOf(BORIS);
    const placed = await checkout([
      { studentId: BORIS, offeringId: lunch.id, sessionIds: sessionsOf(lunch).slice(0, 1) },
    ]);
    const token = tokenOf(placed.body.orders[0]!.checkoutUrl!);
    const claims = dev.readToken(token)!;
    const now = Math.floor(Date.now() / 1000);

    const success = dev.buildEvent(token, claims, 'succeeded', now);
    expect((await sendWebhook(success.body, success.signature)).body.duplicate).toBe(false);
    expect((await sendWebhook(success.body, success.signature)).body.duplicate).toBe(true);
    const successId = (JSON.parse(success.body) as { id: string }).id;
    expect(await inboundStatus(successId)).toBe('processed');

    // A failure created before the success arrives late: it must change nothing.
    const stale = dev.buildEvent(token, claims, 'failed', now - 60);
    await sendWebhook(stale.body, stale.signature);
    expect(await inboundStatus((JSON.parse(stale.body) as { id: string }).id)).toBe('ignored');

    const view = await get<CheckoutGroupView>(`/checkout-groups/${placed.body.checkoutGroupId}`);
    expect(view.body.orders[0]).toMatchObject({ status: 'paid', payment: { status: 'succeeded' } });
    const { rows } = await worker.query<{ count: string }>(
      `SELECT count(*) AS count FROM commerce.payment_allocation a JOIN commerce.order_line l ON l.id = a.order_line_id
        WHERE l.order_id = $1`,
      [placed.body.orders[0]!.orderId],
    );
    expect(rows[0]!.count).toBe('1');
  });

  it('refuses a webhook with a wrong signature', async () => {
    const forged = await fetch(`${API}/webhooks/development`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [DEV_SIGNATURE_HEADER]: `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
      },
      body: JSON.stringify({ id: 'dev_evt_forged', type: 'checkout.completed' }),
    });
    expect(forged.status).toBe(400);
  });

  it('gives the seat back when the payment fails', async () => {
    const { lunch } = await offeringsOf(BORIS);
    const [sessionId] = sessionsOf(lunch);
    const placed = await checkout([{ studentId: BORIS, offeringId: lunch.id, sessionIds: [sessionId] }]);
    const held = (await offeringsOf(BORIS)).lunch.sessions.find((s) => s.id === sessionId)!;
    expect(held.alreadyBooked).toBe(true);

    const back = await pay(placed.body.orders[0]!.checkoutUrl!, 'fail');
    expect(back.location).toContain('?cancelled=1');
    const view = await waitForOrder(placed.body.checkoutGroupId, (v) => v.orders[0]!.status === 'cancelled');
    expect(view.orders[0]!.payment!.status).toBe('failed');
    const released = (await offeringsOf(BORIS)).lunch.sessions.find((s) => s.id === sessionId)!;
    expect(released.alreadyBooked).toBe(false);
    expect(released.available).toBe(held.available! + 1);
  });
});

describe('reservation expiry and late payment', () => {
  async function placeAndExpire(studentId: string) {
    const { lunch } = await offeringsOf(studentId);
    const [sessionId] = sessionsOf(lunch);
    const placed = await checkout([{ studentId, offeringId: lunch.id, sessionIds: [sessionId] }]);
    const orderId = placed.body.orders[0]!.orderId;
    await worker.query(
      `UPDATE commerce.customer_order SET expires_at = now() - interval '1 minute' WHERE id = $1`,
      [orderId],
    );
    expect(await expireReservations(system)).toBeGreaterThanOrEqual(1);
    const view = await get<CheckoutGroupView>(`/checkout-groups/${placed.body.checkoutGroupId}`);
    expect(view.body.orders[0]).toMatchObject({ status: 'expired', payment: { status: 'expired' } });
    return { placed, sessionId: sessionId!, orderId };
  }

  it('releases the seats of an unpaid order when its time runs out', async () => {
    const { sessionId } = await placeAndExpire(MILA);
    const session = (await offeringsOf(MILA)).lunch.sessions.find((s) => s.id === sessionId)!;
    expect(session.alreadyBooked).toBe(false);
  });

  it('accepts a late payment while the seat is still free', async () => {
    const { placed } = await placeAndExpire(MILA);
    await pay(placed.body.orders[0]!.checkoutUrl!, 'succeed');
    const view = await waitForOrder(placed.body.checkoutGroupId, (v) => v.orders[0]!.status === 'paid');
    expect(view.orders[0]!.lines[0]!.status).toBe('confirmed');
  });

  it('turns a late payment into credit when the session filled up meanwhile', async () => {
    const { placed, sessionId, orderId } = await placeAndExpire(BORIS);
    // Someone else took the last seat while the order was expired.
    const { rows } = await owner.query<{ capacity: number | null }>(
      'SELECT capacity FROM scheduling.session WHERE id = $1',
      [sessionId],
    );
    await owner.query(
      'UPDATE scheduling.session SET capacity = reserved_count + confirmed_count WHERE id = $1',
      [sessionId],
    );
    try {
      await pay(placed.body.orders[0]!.checkoutUrl!, 'succeed');
      const view = await waitForOrder(placed.body.checkoutGroupId, (v) => v.orders[0]!.status === 'paid');
      expect(view.orders[0]!.lines[0]!.status).toBe('cancelled');
      const { rows: credits } = await worker.query<{
        remaining_amount_minor: string;
        holder_person_id: string;
      }>(
        `SELECT c.remaining_amount_minor, c.holder_person_id FROM commerce.account_credit c
           JOIN commerce.order_line l ON l.id = c.source_order_line_id WHERE l.order_id = $1`,
        [orderId],
      );
      expect(credits).toEqual([
        {
          remaining_amount_minor: String(placed.body.orders[0]!.totalMinor),
          holder_person_id: 'c1000000-0000-7000-8000-000000000020',
        },
      ]);
      const { rows: ledger } = await worker.query<{ kind: string; amount_minor: string }>(
        `SELECT a.kind, a.amount_minor FROM commerce.payment_allocation a JOIN commerce.order_line l ON l.id = a.order_line_id
          WHERE l.order_id = $1 ORDER BY a.allocated_at, a.kind DESC`,
        [orderId],
      );
      const total = placed.body.orders[0]!.totalMinor;
      expect(ledger).toEqual([
        { kind: 'payment', amount_minor: String(total) },
        { kind: 'credit_issued', amount_minor: String(-total) },
      ]);
    } finally {
      await owner.query('UPDATE scheduling.session SET capacity = $2 WHERE id = $1', [
        sessionId,
        rows[0]!.capacity,
      ]);
    }
  });
});
