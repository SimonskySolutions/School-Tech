import { type CancelBookingResponse, type LunchList, type SchoolId } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Authorised cancellation of one lunch day (M2.8, ADR 0008). Staff with
// bookings.manage at the school cancel the booking and its order line in one
// transaction, as themselves (row-level security applies). The credit is not
// written here: the API may not touch the financial ledger, so an outbox
// event asks the worker to issue it. Nothing else changes: not the enrolment,
// not the child's other bookings, not other lines of the order.

export interface BookingRow {
  id: string;
  status: string;
  kind: string;
  order_line_id: string | null;
  line_status: string | null;
  line_bookings: number;
  order_status: string | null;
  group_id: string;
  service_date: string | null;
  today: string;
  may_manage: boolean;
  credit_minor: string;
  currency: string | null;
}

export type CancelRefusal = { status: 403 | 409 | 422; message: string };

/** Pure: why this booking cannot be cancelled by this person now, or null if it can. */
export function cancelRefusal(row: BookingRow): CancelRefusal | null {
  if (!row.may_manage) return { status: 403, message: 'you may not change bookings at this school' };
  if (row.kind !== 'lunch' || row.service_date === null) {
    return { status: 422, message: 'only a lunch day can be cancelled this way' };
  }
  if (row.status !== 'confirmed')
    return { status: 409, message: `the booking is ${row.status}, not confirmed` };
  if (row.service_date < row.today) return { status: 409, message: 'that day has already passed' };
  if (!row.order_line_id || row.line_status !== 'confirmed' || row.order_status !== 'paid') {
    return { status: 409, message: 'only a paid lunch day can be cancelled for credit' };
  }
  if (row.line_bookings !== 1) return { status: 422, message: 'this order line covers more than one day' };
  return null;
}

const BOOKING_QUERY = `SELECT b.id, b.status, d.kind, b.order_line_id, l.status AS line_status,
            (SELECT count(*)::int FROM scheduling.booking x WHERE x.order_line_id = b.order_line_id) AS line_bookings,
            o.status AS order_status, b.group_id,
            to_char(s.service_date, 'YYYY-MM-DD') AS service_date,
            to_char((now() AT TIME ZONE sc.time_zone)::date, 'YYYY-MM-DD') AS today,
            access.has_permission('bookings.manage', b.school_id) AS may_manage,
            -- What the parent actually paid for this line, net of earlier credits or refunds.
            coalesce((SELECT sum(a.amount_minor) FROM commerce.payment_allocation a WHERE a.order_line_id = l.id), 0)::text
              AS credit_minor,
            l.currency
       FROM scheduling.booking b
       JOIN scheduling.session s ON s.id = b.session_id
       JOIN catalog.school_offering so ON so.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = so.service_definition_id
       JOIN org.school sc ON sc.id = b.school_id
       LEFT JOIN commerce.order_line l ON l.id = b.order_line_id
       LEFT JOIN commerce.customer_order o ON o.id = l.order_id
      WHERE b.id = $1`;

export class CancelRejected extends Error {
  constructor(readonly refusal: CancelRefusal | { status: 404; message: string }) {
    super(refusal.message);
  }
}

export async function cancelLunchBooking(
  tx: PersonTransaction,
  bookingId: string,
  reason: string,
): Promise<CancelBookingResponse> {
  // Read first, then lock: a lock needs the right to change the row, so a role
  // that may only read it would see "no such booking" instead of "not allowed".
  const read = (lock: boolean) =>
    tx.query<BookingRow>(`${BOOKING_QUERY}${lock ? ' FOR UPDATE OF b' : ''}`, [bookingId]);
  const [seen] = await read(false);
  if (!seen) throw new CancelRejected({ status: 404, message: 'no such booking' });
  const early = cancelRefusal(seen);
  if (early) throw new CancelRejected(early);
  // Checked again under the lock, in case another cancellation won the race.
  const [row] = await read(true);
  if (!row) throw new CancelRejected({ status: 409, message: 'the booking changed meanwhile' });
  const refusal = cancelRefusal(row);
  if (refusal) throw new CancelRejected(refusal);

  await tx.query(
    `UPDATE scheduling.booking
        SET status = 'cancelled', cancelled_at = now(), cancelled_by_person_id = app.current_person_id(),
            cancellation_reason = $2
      WHERE id = $1`,
    [bookingId, reason],
  );
  await tx.query(`UPDATE commerce.order_line SET status = 'cancelled' WHERE id = $1`, [row.order_line_id]);
  await tx.query(
    `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'commerce.order_line', $2, 'commerce.order_line.cancelled', $3)`,
    [
      row.group_id,
      row.order_line_id,
      JSON.stringify({ order_line_id: row.order_line_id, booking_id: bookingId }),
    ],
  );
  return {
    bookingId,
    status: 'cancelled',
    creditAmountMinor: Number(row.credit_minor),
    currency: row.currency ?? 'EUR',
  };
}

/** The children booked for lunch at one school on one day. */
export async function lunchList(
  tx: PersonTransaction,
  schoolId: string,
  date: string,
): Promise<LunchList | null> {
  const [school] = await tx.query<{ id: SchoolId; name: string; can_cancel: boolean; may_read: boolean }>(
    `SELECT id, name, access.has_permission('bookings.read', id) AS may_read,
            access.has_permission('bookings.manage', id) AND $2::date >= (now() AT TIME ZONE time_zone)::date
              AS can_cancel
       FROM org.school WHERE id = $1`,
    [schoolId, date],
  );
  if (!school?.may_read) return null;
  const bookings = await tx.query<{
    id: string;
    given_name: string | null;
    family_name: string | null;
    class_label: string | null;
    status: LunchList['bookings'][number]['status'];
  }>(
    `SELECT b.id, p.given_name, p.family_name, e.class_label, b.status
       FROM scheduling.booking b
       JOIN scheduling.session s ON s.id = b.session_id
       JOIN catalog.school_offering so ON so.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = so.service_definition_id
       LEFT JOIN people.person p ON p.id = b.student_person_id
       LEFT JOIN people.enrolment e ON e.student_person_id = b.student_person_id
            AND e.school_id = b.school_id AND e.status = 'active'
      WHERE b.school_id = $1 AND s.service_date = $2::date AND d.kind = 'lunch'
        AND b.status IN ('confirmed', 'attended', 'absent', 'cancelled')
        AND (b.status <> 'cancelled' OR b.cancelled_by_person_id IS NOT NULL)
      ORDER BY b.status = 'cancelled', p.family_name, p.given_name`,
    [schoolId, date],
  );
  return {
    school: { id: school.id, name: school.name },
    date,
    canCancel: school.can_cancel,
    bookings: bookings.map((booking) => ({
      bookingId: booking.id,
      studentName: booking.given_name
        ? [booking.given_name, booking.family_name].filter(Boolean).join(' ')
        : null,
      classLabel: booking.class_label,
      status: booking.status,
    })),
  };
}
