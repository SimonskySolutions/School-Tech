import { type PersonId, type SchoolId, type StudentTrips, type TripParticipants } from '@pythagoras/shared';
import { logSensitiveReads, readsPerChild } from '../common/access-log';
import { type PersonTransaction } from '../database/database';

// Trips and guardian consent (M4.4, ADR 0023). A permission points at the
// exact consent wording in force; the database refuses a trip booking without
// one, and withdrawing it before the trip cancels the place with credit.

export class TripsRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [TripsRejected['status'], string]> = {
  P0002: [404, 'no such permission for this child'],
  '42501': [403, 'not permitted for your account'],
  '23505': [409, 'permission for this trip is already given'],
  '23514': [422, 'a value is not allowed here'],
  PY001: [409, 'the permission is already withdrawn'],
  PY007: [409, 'the trip has started or is cancelled'],
  PY016: [409, 'the trip’s consent wording has changed; please read it again'],
  PY017: [
    409,
    'a payment for this trip is still open; withdraw once it is paid or the reservation has expired',
  ],
};

export async function refusalsAsTrips<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new TripsRejected(refusal[0], refusal[1]);
    throw error;
  }
}

interface TripRow {
  session_id: string;
  offering_id: string;
  offering_name: string;
  school_name: string;
  time_zone: string;
  starts_at: Date;
  ends_at: Date | null;
  location_label: string | null;
  available: number | null;
  booking_cutoff_at: Date | null;
  unit_amount_minor: string | null;
  currency: string | null;
  policy_version_id: string | null;
  wording: string | null;
  permission_id: string | null;
  permission_given_at: Date | null;
  permission_channel: string | null;
  permission_by_me: boolean | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  permission_current: boolean | null;
  booking_status: string | null;
}

/** Upcoming trips at the child's schools, with the wording and the child's permission and booking. */
export async function studentTrips(tx: PersonTransaction, studentId: string): Promise<StudentTrips | null> {
  const [student] = await tx.query<{
    id: PersonId;
    given_name: string;
    family_name: string;
    can_consent: boolean;
  }>(
    `SELECT id, given_name, family_name, access.is_guardian_of(id, 'consent') AS can_consent
       FROM people.person WHERE id = $1 AND access.is_guardian_of(id, 'view')`,
    [studentId],
  );
  if (!student) return null;
  const rows = await tx.query<TripRow>(
    `SELECT s.id AS session_id, o.id AS offering_id, o.name AS offering_name, sc.name AS school_name, sc.time_zone,
            s.starts_at, s.ends_at, s.location_label,
            CASE WHEN s.capacity IS NULL THEN NULL ELSE s.capacity - s.reserved_count - s.confirmed_count END AS available,
            s.booking_cutoff_at, pv.unit_amount_minor, pv.currency,
            w.id AS policy_version_id, w.terms_text AS wording,
            tp.id AS permission_id, tp.given_at AS permission_given_at, tp.channel AS permission_channel,
            tp.given_by_person_id = app.current_person_id() AS permission_by_me,
            tp.emergency_contact_name, tp.emergency_contact_phone,
            tp.policy_version_id = w.id AS permission_current,
            (SELECT b.status FROM scheduling.booking b
              WHERE b.session_id = s.id AND b.student_person_id = $1
                AND b.status IN ('reserved', 'confirmed', 'attended', 'absent') LIMIT 1) AS booking_status
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id AND o.status = 'published'
       JOIN catalog.service_definition d ON d.id = o.service_definition_id AND d.kind = 'trip'
       JOIN org.school sc ON sc.id = s.school_id
       LEFT JOIN catalog.policy_version w ON w.id = catalog.current_trip_consent(o.id)
       LEFT JOIN LATERAL (SELECT p.unit_amount_minor, p.currency FROM catalog.price_version p
                           WHERE p.offering_id = o.id AND p.variant_id IS NULL
                             AND p.valid_from <= now() AND (p.valid_until IS NULL OR p.valid_until > now())
                           ORDER BY p.valid_from DESC LIMIT 1) pv ON true
       LEFT JOIN scheduling.trip_permission tp
              ON tp.session_id = s.id AND tp.student_person_id = $1 AND tp.status = 'given'
      WHERE s.status = 'scheduled' AND s.starts_at > now()
        AND s.school_id IN (SELECT e.school_id FROM people.enrolment e
                             WHERE e.student_person_id = $1 AND e.status = 'active'
                               AND e.start_date <= current_date AND (e.end_date IS NULL OR e.end_date > current_date))
      ORDER BY s.starts_at`,
    [studentId],
  );
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    canConsent: student.can_consent,
    trips: rows.map((row) => ({
      sessionId: row.session_id,
      offeringId: row.offering_id,
      name: row.offering_name,
      schoolName: row.school_name,
      timeZone: row.time_zone,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at?.toISOString() ?? null,
      location: row.location_label,
      available: row.available,
      bookingCutoffAt: row.booking_cutoff_at?.toISOString() ?? null,
      price:
        row.unit_amount_minor === null
          ? null
          : { unitAmountMinor: Number(row.unit_amount_minor), currency: row.currency! },
      consent: row.policy_version_id
        ? { policyVersionId: row.policy_version_id, wording: row.wording! }
        : null,
      permission: row.permission_id
        ? {
            id: row.permission_id,
            givenAt: row.permission_given_at!.toISOString(),
            channel: row.permission_channel as 'family_portal' | 'paper' | 'in_person',
            givenByMe: row.permission_by_me ?? false,
            emergencyContactName: row.emergency_contact_name!,
            emergencyContactPhone: row.emergency_contact_phone!,
            forCurrentWording: row.permission_current ?? false,
          }
        : null,
      booking: row.booking_status as StudentTrips['trips'][number]['booking'],
    })),
  };
}

export async function givePermission(
  tx: PersonTransaction,
  studentId: string,
  sessionId: string,
  body: { policyVersionId: string; emergencyContactName: string; emergencyContactPhone: string },
): Promise<{ permissionId: string }> {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO scheduling.trip_permission
       (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel,
        emergency_contact_name, emergency_contact_phone)
     SELECT s.group_id, s.school_id, s.id, $2, $3, app.current_person_id(), 'family_portal', $4, $5
       FROM scheduling.session s WHERE s.id = $1
     RETURNING id`,
    [sessionId, studentId, body.policyVersionId, body.emergencyContactName, body.emergencyContactPhone],
  );
  if (!row) throw new TripsRejected(404, 'no such trip');
  return { permissionId: row.id };
}

/** Staff record a permission a guardian gave on paper or in person. */
export async function recordPermission(
  tx: PersonTransaction,
  sessionId: string,
  body: {
    studentId: string;
    guardianPersonId: string;
    channel: 'paper' | 'in_person';
    policyVersionId: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
  },
): Promise<{ permissionId: string }> {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO scheduling.trip_permission
       (group_id, school_id, session_id, student_person_id, policy_version_id, given_by_person_id, channel,
        recorded_by_person_id, emergency_contact_name, emergency_contact_phone)
     SELECT s.group_id, s.school_id, s.id, $2, $3, $4, $5, app.current_person_id(), $6, $7
       FROM scheduling.session s WHERE s.id = $1
     RETURNING id`,
    [
      sessionId,
      body.studentId,
      body.policyVersionId,
      body.guardianPersonId,
      body.channel,
      body.emergencyContactName,
      body.emergencyContactPhone,
    ],
  );
  if (!row) throw new TripsRejected(404, 'no such trip');
  return { permissionId: row.id };
}

export async function withdrawPermission(
  tx: PersonTransaction,
  studentId: string,
  permissionId: string,
): Promise<{ permissionId: string; outcome: 'withdrawn' | 'withdrawn_and_cancelled' }> {
  const [owned] = await tx.query(
    'SELECT 1 FROM scheduling.trip_permission WHERE id = $1 AND student_person_id = $2',
    [permissionId, studentId],
  );
  if (!owned) throw new TripsRejected(404, 'no such permission for this child');
  const [row] = await tx.query<{ outcome: 'withdrawn' | 'withdrawn_and_cancelled' }>(
    'SELECT scheduling.withdraw_trip_permission($1) AS outcome',
    [permissionId],
  );
  return { permissionId, outcome: row!.outcome };
}

/** Trips in a range at the schools the viewer may see, with who is coming. */
export async function tripParticipants(
  tx: PersonTransaction,
  range: { from: string; days: number },
): Promise<TripParticipants> {
  const trips = await tx.query<{
    session_id: string;
    offering_name: string;
    school_id: SchoolId;
    school_name: string;
    time_zone: string;
    starts_at: Date;
    ends_at: Date | null;
    location_label: string | null;
    capacity: number | null;
    confirmed_count: number;
    reserved_count: number;
    shows_dietary: boolean;
  }>(
    `SELECT s.id AS session_id, o.name AS offering_name, s.school_id, sc.name AS school_name, sc.time_zone,
            s.starts_at, s.ends_at, s.location_label, s.capacity, s.confirmed_count, s.reserved_count,
            access.has_permission('sensitive.dietary.read', s.school_id) AS shows_dietary
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id AND d.kind = 'trip'
       JOIN org.school sc ON sc.id = s.school_id
      WHERE s.status <> 'cancelled' AND access.has_permission('bookings.read', s.school_id)
        AND (s.starts_at AT TIME ZONE sc.time_zone)::date BETWEEN $1::date AND $1::date + ($2::int - 1)
      ORDER BY s.starts_at`,
    [range.from, range.days],
  );
  const ids = trips.map((trip) => trip.session_id);
  const people = ids.length
    ? await tx.query<{
        session_id: string;
        student_person_id: string;
        school_id: string;
        given_name: string | null;
        family_name: string | null;
        class_label: string | null;
        status: string;
        permission_given_at: Date | null;
        permission_channel: string | null;
        guardian_given: string | null;
        guardian_family: string | null;
        emergency_contact_name: string | null;
        emergency_contact_phone: string | null;
      }>(
        `SELECT b.session_id, b.student_person_id, b.school_id, p.given_name, p.family_name, e.class_label, b.status,
                tp.given_at AS permission_given_at, tp.channel AS permission_channel,
                g.given_name AS guardian_given, g.family_name AS guardian_family,
                tp.emergency_contact_name, tp.emergency_contact_phone
           FROM scheduling.booking b
           LEFT JOIN people.person p ON p.id = b.student_person_id
           LEFT JOIN people.enrolment e ON e.student_person_id = b.student_person_id
                AND e.school_id = b.school_id AND e.status = 'active'
           LEFT JOIN scheduling.trip_permission tp
                  ON tp.session_id = b.session_id AND tp.student_person_id = b.student_person_id AND tp.status = 'given'
           LEFT JOIN people.person g ON g.id = tp.given_by_person_id
          WHERE b.session_id = ANY ($1::uuid[]) AND b.status IN ('confirmed', 'attended', 'absent')
          ORDER BY p.family_name, p.given_name`,
        [ids],
      )
    : [];
  const dietary = people.length
    ? await tx.query<{
        student_person_id: string;
        school_id: string | null;
        kind: string;
        severity: string | null;
        description: string;
      }>(
        `SELECT dr.student_person_id, NULL::uuid AS school_id, dr.kind, dr.severity, dr.description
           FROM sensitive.dietary_requirement dr
          WHERE dr.student_person_id = ANY ($1::uuid[]) AND (dr.valid_until IS NULL OR dr.valid_until >= current_date)
          ORDER BY dr.created_at`,
        [[...new Set(people.map((person) => person.student_person_id))]],
      )
    : [];
  await logSensitiveReads(tx, 'sensitive.dietary_requirement:trip', readsPerChild(dietary));
  const name = (given: string | null, family: string | null) =>
    given ? [given, family].filter(Boolean).join(' ') : null;
  return {
    ...range,
    trips: trips.map((trip) => ({
      sessionId: trip.session_id,
      name: trip.offering_name,
      school: { id: trip.school_id, name: trip.school_name, timeZone: trip.time_zone },
      startsAt: trip.starts_at.toISOString(),
      endsAt: trip.ends_at?.toISOString() ?? null,
      location: trip.location_label,
      capacity: trip.capacity,
      booked: trip.confirmed_count,
      awaitingPayment: trip.reserved_count,
      participants: people
        .filter((person) => person.session_id === trip.session_id)
        .map((person) => ({
          studentName: name(person.given_name, person.family_name),
          classLabel: person.class_label,
          status: person.status,
          permission: person.permission_given_at
            ? {
                givenAt: person.permission_given_at.toISOString(),
                channel: person.permission_channel as 'family_portal' | 'paper' | 'in_person',
                givenBy: name(person.guardian_given, person.guardian_family),
              }
            : null,
          emergencyContact: person.emergency_contact_name
            ? { name: person.emergency_contact_name, phone: person.emergency_contact_phone! }
            : null,
          dietary: trip.shows_dietary
            ? dietary
                .filter((need) => need.student_person_id === person.student_person_id)
                .map((need) => ({ kind: need.kind, severity: need.severity, description: need.description }))
            : [],
        })),
    })),
  };
}

/** New consent wording for a trip: the current version ends now and the new one starts. */
export async function setTripConsent(
  tx: PersonTransaction,
  schoolId: string,
  offeringId: string,
  text: string,
): Promise<{ offeringId: string; policyVersionId: string; version: number }> {
  const [offering] = await tx.query<{ id: string; group_id: string; kind: string }>(
    `SELECT o.id, o.group_id, d.kind FROM catalog.school_offering o
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
      WHERE o.id = $1 AND o.school_id = $2`,
    [offeringId, schoolId],
  );
  if (!offering) throw new TripsRejected(404, 'no such trip at this school');
  if (offering.kind !== 'trip') throw new TripsRejected(422, 'consent wording is for trips');
  await tx.query(
    `UPDATE catalog.policy_version SET valid_until = now()
      WHERE offering_id = $1 AND kind = 'trip_consent' AND (valid_until IS NULL OR valid_until > now())`,
    [offeringId],
  );
  const [row] = await tx.query<{ id: string; version: number }>(
    `INSERT INTO catalog.policy_version (group_id, offering_id, kind, version, terms_text, valid_from, created_by_person_id)
     SELECT $1, $2, 'trip_consent', coalesce(max(version), 0) + 1, $3, now(), app.current_person_id()
       FROM catalog.policy_version WHERE offering_id = $2 AND kind = 'trip_consent'
     RETURNING id, version`,
    [offering.group_id, offeringId, text],
  );
  return { offeringId, policyVersionId: row!.id, version: row!.version };
}
