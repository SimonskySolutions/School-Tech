import { type CheckoutResponse, type SchoolUniforms, type StudentOfferings } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, MILA, payAndWait, post, tokenFor } from './helpers';

// Uniforms (M4.6) against the real stack. The seed has the School A polo shirt
// in sizes 116 and 128 (10 each), 140 (one left) and 152 (none). Anna races for
// the last 140 and pays; staff hand it over; a failed payment releases what it
// held; staff take in deliveries and add a variant.

const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const POLO = 'd2000000-0000-7000-8000-0000000000a9';
const SIZE_128 = 'd6000000-0000-7000-8000-0000000000a2';
const SIZE_140 = 'd6000000-0000-7000-8000-0000000000a3';
const SIZE_152 = 'd6000000-0000-7000-8000-0000000000a4';

const tokens: Record<string, string> = {};
const buy = (variantId: string, quantity = 1) =>
  fetch(`${API}/checkout`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${tokens['anna.ivanova']}`,
      'content-type': 'application/json',
      'idempotency-key': crypto.randomUUID(),
    },
    body: JSON.stringify({ items: [{ studentId: MILA, offeringId: POLO, variantId, quantity }] }),
  });
const stockOf = async (variantId: string, user = 'schoollife') =>
  (await get<SchoolUniforms>(`/schools/${SCHOOL_A}/uniforms`, tokens[user]!)).body.products
    .flatMap((product) => product.variants)
    .find((variant) => variant.id === variantId)!;

beforeAll(async () => {
  for (const user of ['anna.ivanova', 'schoollife', 'kitchen.a', 'principal.a', 'admin', 'teacher.b']) {
    tokens[user] = await tokenFor(user);
  }
});

describe('buying uniforms', () => {
  it('shows Anna the polo shirt by size with prices and what is left', async () => {
    const { body } = await get<StudentOfferings>(`/students/${MILA}/offerings`, tokens['anna.ivanova']!);
    const polo = body.uniforms.find((product) => product.id === POLO)!;
    expect(polo.name).toBe('School polo shirt, School A');
    expect(
      polo.variants.map((variant) => [variant.size, variant.price.unitAmountMinor, variant.available]),
    ).toEqual([
      ['116', 2500, 10],
      ['128', 2500, 10],
      ['140', 2500, 1],
      ['152', 2800, 0],
    ]);
    expect(body.offerings.some((offering) => offering.id === POLO)).toBe(false);
  });

  it('refuses sizes that are sold out or more than five at a time', async () => {
    const soldOut = await buy(SIZE_152);
    expect(soldOut.status).toBe(409);
    expect(((await soldOut.json()) as { message: string }).message).toBe(
      'only 0 of School polo shirt, School A, 152, Navy left',
    );
    expect((await buy(SIZE_128, 6)).status).toBe(400);
  });

  it('gives the last size 140 to exactly one of two simultaneous orders', async () => {
    const results = await Promise.all([buy(SIZE_140), buy(SIZE_140)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const winner = (await results.find((r) => r.status === 201)!.json()) as CheckoutResponse;
    expect(await stockOf(SIZE_140)).toMatchObject({ onHand: 1, reserved: 1, free: 0, lowStock: true });
    await payAndWait(tokens['anna.ivanova']!, winner);
    expect(await stockOf(SIZE_140)).toMatchObject({ onHand: 1, reserved: 0, allocated: 1 });
  });
});

describe('handing over and stock', () => {
  it('lists the paid shirt to hand over, and lets only staff who manage bookings hand it over', async () => {
    const view = (await get<SchoolUniforms>(`/schools/${SCHOOL_A}/uniforms`, tokens.schoollife!)).body;
    const waiting = view.awaitingHandOver.find((item) => item.variant === '140')!;
    expect(waiting).toMatchObject({ studentName: 'Mila Ivanova', classLabel: '3A', quantity: 1 });
    const path = `/schools/${SCHOOL_A}/uniform-handovers/${waiting.reservationId}`;
    expect((await post(tokens['kitchen.a']!, path)).status).toBe(403);
    expect((await post(tokens['teacher.b']!, path)).status).toBe(404);
    expect((await post(tokens['principal.a']!, path)).status).toBe(200);
    expect((await post(tokens['principal.a']!, path)).status).toBe(409);
    expect(await stockOf(SIZE_140)).toMatchObject({ onHand: 0, allocated: 0, free: 0 });
  });

  it('releases the items of an order whose payment failed', async () => {
    const response = await buy(SIZE_128, 2);
    expect(response.status).toBe(201);
    const placed = (await response.json()) as CheckoutResponse;
    expect((await stockOf(SIZE_128)).reserved).toBe(2);
    const token = placed.orders[0]!.checkoutUrl!.split('/dev-payments/checkout/')[1]!;
    await fetch(`${API}/dev-payments/checkout/${token}/fail`, { method: 'POST', redirect: 'manual' });
    const deadline = Date.now() + 15_000;
    while ((await stockOf(SIZE_128)).reserved !== 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(await stockOf(SIZE_128)).toMatchObject({ onHand: 10, reserved: 0, free: 10 });
  });

  it('takes in a delivery, refuses corrections below what is held, and keeps the kitchen out', async () => {
    const path = `/schools/${SCHOOL_A}/uniform-variants/${SIZE_152}/stock`;
    const delivery = { kind: 'delivery', delta: 3, reason: 'Delivery (integration test)' };
    expect((await post(tokens['kitchen.a']!, path, delivery)).status).toBe(403);
    const done = await post<{ onHand: number }>(tokens['principal.a']!, path, delivery);
    expect(done.status).toBe(200);
    expect(done.body.onHand).toBe(3);
    const tooMany = await post(tokens['principal.a']!, path, {
      kind: 'correction',
      delta: -4,
      reason: 'Counted (integration test)',
    });
    expect(tooMany.status).toBe(409);
    expect(
      (await post(tokens['principal.a']!, path, { kind: 'delivery', delta: -1, reason: 'x' })).status,
    ).toBe(400);
  });

  it('lets the administrator add a variant with its price, once', async () => {
    const variant = {
      offeringId: POLO,
      sku: 'TEST-POLO-164',
      size: '164',
      colour: 'Navy',
      unitAmountMinor: 3000,
    };
    const added = await post<{ variantId: string }>(
      tokens.admin!,
      `/schools/${SCHOOL_A}/uniform-variants`,
      variant,
    );
    expect(added.status).toBe(201);
    expect((await post(tokens.admin!, `/schools/${SCHOOL_A}/uniform-variants`, variant)).status).toBe(409);
    expect(await stockOf(added.body.variantId)).toMatchObject({
      size: '164',
      price: { unitAmountMinor: 3000 },
      onHand: 0,
      lowStock: true,
    });
  });
});
