import { describe, expect, it } from 'vitest';
import { type BookingRow, cancelRefusal } from './cancellation';

const paidLunch: BookingRow = {
  id: 'booking',
  status: 'confirmed',
  kind: 'lunch',
  order_line_id: 'line',
  line_status: 'confirmed',
  line_bookings: 1,
  order_status: 'paid',
  group_id: 'group',
  service_date: '2026-11-02',
  today: '2026-10-29',
  may_manage: true,
  credit_minor: '450',
  currency: 'EUR',
};

describe('cancelRefusal', () => {
  it('allows staff to cancel a paid lunch day today or later', () => {
    expect(cancelRefusal(paidLunch)).toBeNull();
    expect(cancelRefusal({ ...paidLunch, today: '2026-11-02' })).toBeNull();
  });

  it('refuses staff without bookings.manage', () => {
    expect(cancelRefusal({ ...paidLunch, may_manage: false })?.status).toBe(403);
  });

  it('refuses a day that has passed, an unpaid or already cancelled booking', () => {
    expect(cancelRefusal({ ...paidLunch, today: '2026-11-03' })?.status).toBe(409);
    expect(cancelRefusal({ ...paidLunch, status: 'cancelled' })?.status).toBe(409);
    expect(cancelRefusal({ ...paidLunch, status: 'reserved' })?.status).toBe(409);
    expect(cancelRefusal({ ...paidLunch, order_status: 'pending_payment' })?.status).toBe(409);
    expect(
      cancelRefusal({ ...paidLunch, order_line_id: null, line_status: null, order_status: null })?.status,
    ).toBe(409);
  });

  it('cancels only lunch, never a club that covers many sessions', () => {
    expect(cancelRefusal({ ...paidLunch, kind: 'activity', service_date: null })?.status).toBe(422);
    expect(cancelRefusal({ ...paidLunch, line_bookings: 8 })?.status).toBe(422);
  });
});
