import { describe, expect, it } from 'vitest';
import {
  basketFromForm,
  checkoutError,
  formatServiceDate,
  minutesLeft,
  orderStatus,
  type Order,
} from './services';

describe('basketFromForm', () => {
  it('groups lunch days per child and offering, and keeps clubs separate', () => {
    const items = basketFromForm([
      ['idempotency_key', 'k'],
      ['lunch', 'mila|lunch-a|day-1'],
      ['lunch', 'mila|lunch-a|day-2'],
      ['lunch', 'boris|lunch-c|day-1'],
      ['lunch', 'mila|lunch-a|day-2'],
      ['activity', 'mila|chess'],
      ['package', 'mila|piano'],
      ['trip', 'mila|museum'],
      ['transport', 'mila|bus|stop-2'],
      ['transport', ''],
      ['uniform', 'mila|polo|polo-128|2'],
      ['uniform', 'mila|polo|polo-140|9'],
      ['uniform', ''],
    ]);
    expect(items).toEqual([
      { studentId: 'mila', offeringId: 'lunch-a', sessionIds: ['day-1', 'day-2'] },
      { studentId: 'boris', offeringId: 'lunch-c', sessionIds: ['day-1'] },
      { studentId: 'mila', offeringId: 'chess' },
      { studentId: 'mila', offeringId: 'piano' },
      { studentId: 'mila', offeringId: 'museum' },
      { studentId: 'mila', offeringId: 'bus', stopId: 'stop-2' },
      { studentId: 'mila', offeringId: 'polo', variantId: 'polo-128', quantity: 2 },
    ]);
  });

  it('ignores malformed values', () => {
    expect(
      basketFromForm([
        ['lunch', 'only|two'],
        ['activity', 'a|b|c'],
        ['other', 'x|y'],
      ]),
    ).toEqual([]);
  });
});

describe('checkoutError', () => {
  it('tells the parent when places were just taken', () => {
    expect(checkoutError(409)).toBe('unavailable');
    expect(checkoutError(403)).toBe('forbidden');
    expect(checkoutError(422)).toBe('invalid');
    expect(checkoutError(502)).toBe('failed');
  });
});

describe('dates and times', () => {
  it('shows a calendar date without shifting it by time zone', () => {
    expect(formatServiceDate('2026-10-30')).toBe('Fri 30 Oct');
  });

  it('counts the minutes a reservation is still held', () => {
    expect(minutesLeft('2026-10-29T10:30:00Z', Date.parse('2026-10-29T10:00:30Z'))).toBe(30);
    expect(minutesLeft('2026-10-29T10:00:00Z', Date.parse('2026-10-29T11:00:00Z'))).toBe(0);
    expect(minutesLeft(null)).toBeNull();
  });
});

describe('orderStatus', () => {
  const order = (status: string, lines: string[] = ['confirmed']): Order => ({
    orderId: 'o',
    orderNumber: 'PY-00000001',
    status,
    billingEntityName: 'Testing Company',
    totalMinor: 450,
    currency: 'EUR',
    expiresAt: null,
    paidAt: null,
    checkoutUrl: null,
    payment: null,
    lines: lines.map((line) => ({
      description: 'Lunch',
      studentName: 'Mila',
      serviceDate: null,
      totalMinor: 450,
      status: line,
    })),
  });

  it('says paid only for an order the worker marked paid', () => {
    expect(orderStatus(order('pending_payment'))).toMatchObject({
      label: 'Awaiting payment',
      settled: false,
    });
    expect(orderStatus(order('paid'))).toMatchObject({ label: 'Paid', settled: true });
  });

  it('explains credit for a late payment whose place was taken', () => {
    expect(orderStatus(order('paid', ['confirmed', 'cancelled'])).detail).toContain('credit');
  });

  it('explains failed and expired orders', () => {
    expect(orderStatus(order('cancelled')).label).toBe('Payment failed');
    expect(orderStatus(order('expired')).label).toBe('Not paid in time');
  });
});
