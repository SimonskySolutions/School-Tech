import { describe, expect, it } from 'vitest';
import { type OfferingRow, type SessionRow } from '../catalog/catalog.repository';
import { CheckoutRejected, planCheckout } from './checkout-plan';

const offering = (id: string, overrides: Partial<OfferingRow> = {}): OfferingRow => ({
  id,
  kind: 'lunch',
  name: `Offering ${id}`,
  school_id: 'school-a',
  school_name: 'School A',
  billing_entity_id: 'company-1',
  billing_entity_name: 'Testing Company',
  price_version_id: `price-${id}`,
  unit_amount_minor: '450',
  currency: 'EUR',
  price_unit: 'per_day',
  vat_rate_bp: 0,
  package_size: null,
  eligibility: {},
  ...overrides,
});

const session = (id: string, offeringId: string, date: string | null = '2026-11-02'): SessionRow => ({
  id,
  offering_id: offeringId,
  service_date: date,
  starts_at: date ? null : new Date('2026-11-04T12:00:00Z'),
  ends_at: null,
  location_label: null,
  available: 10,
  booking_cutoff_at: null,
});

const lunchA = offering('lunch-a');
const lunchC = offering('lunch-c', { school_id: 'school-c', unit_amount_minor: '500' });
const chess = offering('chess', { kind: 'activity', price_unit: 'per_term', unit_amount_minor: '6000' });
const piano = offering('piano', {
  kind: 'lesson',
  name: 'Piano',
  price_unit: 'per_package',
  package_size: 5,
  unit_amount_minor: '12000',
});
const bus = offering('bus', {
  kind: 'transport',
  name: 'Bus 1',
  price_unit: 'per_term',
  unit_amount_minor: '9000',
});
const route = {
  vehicle: null,
  weekdays: [1, 2, 3, 4, 5],
  stops: [
    { id: 'stop-1', position: 1, name: 'Park', pickupTime: '07:30', dropoffTime: null, active: true },
    { id: 'stop-2', position: 2, name: 'Closed', pickupTime: '07:40', dropoffTime: null, active: false },
  ],
};
const polo = {
  offeringId: 'polo',
  offeringName: 'Polo shirt',
  schoolId: 'school-a',
  billingEntityId: 'company-1',
  billingEntityName: 'Testing Company',
  label: '128, Navy',
  priceVersionId: 'price-polo-128',
  unitAmountMinor: 2500,
  currency: 'EUR',
  vatRateBp: 0,
  free: 2,
};
const otherCompany = offering('other', {
  billing_entity_id: 'company-2',
  billing_entity_name: 'Second Company',
});

const input = (items: Parameters<typeof planCheckout>[0]['items']) =>
  planCheckout({
    items,
    offeringsByStudent: new Map([
      ['mila', new Map([lunchA, chess, piano, bus, otherCompany].map((o) => [o.id, o]))],
      ['boris', new Map([[lunchC.id, lunchC]])],
    ]),
    openSessionsByOffering: new Map([
      ['lunch-a', [session('a1', 'lunch-a'), session('a2', 'lunch-a', '2026-11-03')]],
      ['lunch-c', [session('c1', 'lunch-c')]],
      ['chess', [session('k1', 'chess', null), session('k2', 'chess', null)]],
      ['other', [session('o1', 'other')]],
      ['piano', [session('p1', 'piano', null), session('p2', 'piano', null)]],
      ['bus', [session('term', 'bus', null)]],
    ]),
    routesByOffering: new Map([['bus', route]]),
    uniformsByStudent: new Map([['mila', new Map([['polo-128', polo]])]]),
  });

const rejection = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof CheckoutRejected) return error.status;
    throw error;
  }
  throw new Error('expected a rejection');
};

describe('planCheckout', () => {
  it('makes one line per lunch day and one line for a whole club, in one order per company', () => {
    const orders = input([
      { studentId: 'mila', offeringId: 'lunch-a', sessionIds: ['a1', 'a2'] },
      { studentId: 'boris', offeringId: 'lunch-c', sessionIds: ['c1'] },
      { studentId: 'mila', offeringId: 'chess' },
    ]);
    expect(orders).toHaveLength(1);
    const [order] = orders;
    expect(order).toMatchObject({
      billingEntityName: 'Testing Company',
      currency: 'EUR',
      totalMinor: 450 * 2 + 500 + 6000,
    });
    expect(order!.lines.map((line) => [line.studentId, line.description, line.bookingSessionIds])).toEqual([
      ['mila', 'Offering lunch-a, 2026-11-02', ['a1']],
      ['mila', 'Offering lunch-a, 2026-11-03', ['a2']],
      ['boris', 'Offering lunch-c, 2026-11-02', ['c1']],
      ['mila', 'Offering chess (2 sessions)', ['k1', 'k2']],
    ]);
    // Each line carries the school it is revenue for.
    expect(order!.lines[2]!.schoolId).toBe('school-c');
  });

  it('splits the basket by billing company', () => {
    const orders = input([
      { studentId: 'mila', offeringId: 'lunch-a', sessionIds: ['a1'] },
      { studentId: 'mila', offeringId: 'other', sessionIds: ['o1'] },
    ]);
    expect(orders.map((order) => [order.billingEntityName, order.totalMinor])).toEqual([
      ['Testing Company', 450],
      ['Second Company', 450],
    ]);
  });

  it("refuses an offering that is not available for the child's school", () => {
    expect(rejection(() => input([{ studentId: 'boris', offeringId: 'lunch-a', sessionIds: ['a1'] }]))).toBe(
      422,
    );
    expect(rejection(() => input([{ studentId: 'kalina', offeringId: 'lunch-a', sessionIds: ['a1'] }]))).toBe(
      422,
    );
  });

  it('refuses days that are no longer open, a lunch without days, and duplicates', () => {
    expect(rejection(() => input([{ studentId: 'mila', offeringId: 'lunch-a', sessionIds: ['gone'] }]))).toBe(
      409,
    );
    expect(rejection(() => input([{ studentId: 'mila', offeringId: 'lunch-a', sessionIds: [] }]))).toBe(422);
    expect(
      rejection(() =>
        input([
          { studentId: 'mila', offeringId: 'chess' },
          { studentId: 'mila', offeringId: 'chess' },
        ]),
      ),
    ).toBe(422);
    expect(rejection(() => input([]))).toBe(422);
  });

  it('counts a repeated day in one item once', () => {
    const [order] = input([{ studentId: 'mila', offeringId: 'lunch-a', sessionIds: ['a1', 'a1'] }]);
    expect(order!.lines).toHaveLength(1);
  });

  it('sells a package of lessons as one line that books no slot, once per basket', () => {
    const [order] = input([{ studentId: 'mila', offeringId: 'piano', sessionIds: ['p1'] }]);
    expect(order!.lines).toEqual([
      expect.objectContaining({
        description: 'Piano (5 lessons)',
        sessionId: null,
        bookingSessionIds: [],
        unitAmountMinor: 12000,
      }),
    ]);
    expect(order!.totalMinor).toBe(12000);
    expect(
      rejection(() =>
        input([
          { studentId: 'mila', offeringId: 'piano' },
          { studentId: 'mila', offeringId: 'piano' },
        ]),
      ),
    ).toBe(422);
  });

  it('sells a transport seat for the term with the stop the family chose, and needs an active stop', () => {
    const [order] = input([{ studentId: 'mila', offeringId: 'bus', stopId: 'stop-1' }]);
    expect(order!.lines).toEqual([
      expect.objectContaining({
        description: 'Bus 1, from Park',
        bookingSessionIds: ['term'],
        transportStopId: 'stop-1',
      }),
    ]);
    expect(rejection(() => input([{ studentId: 'mila', offeringId: 'bus' }]))).toBe(422);
    expect(rejection(() => input([{ studentId: 'mila', offeringId: 'bus', stopId: 'stop-2' }]))).toBe(422);
  });

  it('sells uniform items as one line per variant with a quantity, holding that much stock', () => {
    const [order] = input([{ studentId: 'mila', offeringId: 'polo', variantId: 'polo-128', quantity: 2 }]);
    expect(order!.lines).toEqual([
      expect.objectContaining({
        description: 'Polo shirt, 128, Navy',
        quantity: 2,
        unitAmountMinor: 2500,
        priceVersionId: 'price-polo-128',
        bookingSessionIds: [],
        stock: { variantId: 'polo-128', quantity: 2 },
      }),
    ]);
    expect(order!.totalMinor).toBe(5000);
  });

  it('refuses more than is free, more than five, or a variant of another product', () => {
    expect(
      rejection(() => input([{ studentId: 'mila', offeringId: 'polo', variantId: 'polo-128', quantity: 3 }])),
    ).toBe(409);
    expect(
      rejection(() => input([{ studentId: 'mila', offeringId: 'polo', variantId: 'polo-128', quantity: 6 }])),
    ).toBe(422);
    expect(rejection(() => input([{ studentId: 'mila', offeringId: 'chess', variantId: 'polo-128' }]))).toBe(
      422,
    );
    expect(rejection(() => input([{ studentId: 'boris', offeringId: 'polo', variantId: 'polo-128' }]))).toBe(
      422,
    );
  });
});

describe('enrolment fees (M5.8)', () => {
  const fee = {
    ...offering('fee-a', {
      name: 'Enrolment fee, School A',
      price_unit: 'one_off',
      unit_amount_minor: '15000',
    }),
    kind: 'fee' as const,
  };

  it('makes one line with nothing to book, for a fee the child owes', () => {
    const [order] = planCheckout({
      items: [{ studentId: 'nia', offeringId: 'fee-a' }],
      offeringsByStudent: new Map(),
      openSessionsByOffering: new Map(),
      feesByStudent: new Map([['nia', new Map([['fee-a', fee]])]]),
    });
    expect(order).toMatchObject({ totalMinor: 15000, billingEntityId: 'company-1' });
    expect(order!.lines).toEqual([
      expect.objectContaining({
        description: 'Enrolment fee, School A',
        quantity: 1,
        bookingSessionIds: [],
        sessionId: null,
      }),
    ]);
  });

  it('refuses a fee the child does not owe, and the same fee twice in one basket', () => {
    const plan =
      (
        items: { studentId: string; offeringId: string }[],
        fees = new Map([['nia', new Map([['fee-a', fee]])]]),
      ) =>
      () =>
        planCheckout({
          items,
          offeringsByStudent: new Map(),
          openSessionsByOffering: new Map(),
          feesByStudent: fees,
        });
    expect(plan([{ studentId: 'mila', offeringId: 'fee-a' }])).toThrow(CheckoutRejected);
    expect(
      plan([
        { studentId: 'nia', offeringId: 'fee-a' },
        { studentId: 'nia', offeringId: 'fee-a' },
      ]),
    ).toThrow(CheckoutRejected);
  });
});
