import {
  type SchoolId,
  type SchoolTransport,
  type TransportRoute,
  type TransportRuns,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Transport routes, stops and seats (M4.5, ADR 0024). A route for one term is
// a transport offering; the term is its one session and a seat is a booking
// of it that names a stop. The database checks the stop and the seats.

export class TransportRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [TransportRejected['status'], string]> = {
  '42501': [403, 'not permitted'],
  '23505': [409, 'already exists'],
  '23514': [422, 'routes are for transport offerings, and weekdays are 1 to 7'],
  '23503': [422, 'the request refers to something that does not belong together'],
};

export async function refusalsAsTransport<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new TransportRejected(refusal[0], refusal[1]);
    throw error;
  }
}

interface RouteRow {
  offering_id: string;
  vehicle: string | null;
  weekdays: number[];
}
interface StopRow {
  id: string;
  offering_id: string;
  position: number;
  name: string;
  pickup_time: string;
  dropoff_time: string | null;
  status: string;
}

/** Routes with their active stops in order, keyed by offering. */
export async function findRoutes(
  tx: PersonTransaction,
  offeringIds: readonly string[],
  includeRetired = false,
): Promise<Map<string, TransportRoute>> {
  if (offeringIds.length === 0) return new Map();
  const routes = await tx.query<RouteRow>(
    'SELECT offering_id, vehicle, weekdays FROM scheduling.transport_route WHERE offering_id = ANY ($1::uuid[])',
    [offeringIds],
  );
  const stops = await tx.query<StopRow>(
    `SELECT id, offering_id, position, name, to_char(pickup_time, 'HH24:MI') AS pickup_time,
            to_char(dropoff_time, 'HH24:MI') AS dropoff_time, status
       FROM scheduling.transport_stop
      WHERE offering_id = ANY ($1::uuid[]) AND ($2 OR status = 'active')
      ORDER BY offering_id, position`,
    [offeringIds, includeRetired],
  );
  return new Map(
    routes.map((route) => [
      route.offering_id,
      {
        vehicle: route.vehicle,
        weekdays: route.weekdays,
        stops: stops
          .filter((stop) => stop.offering_id === route.offering_id)
          .map((stop) => ({
            id: stop.id,
            position: stop.position,
            name: stop.name,
            pickupTime: stop.pickup_time,
            dropoffTime: stop.dropoff_time,
            active: stop.status === 'active',
          })),
      },
    ]),
  );
}

/** The routes of one school with their terms and seats, for staff. */
export async function schoolTransport(
  tx: PersonTransaction,
  schoolId: string,
): Promise<SchoolTransport | null> {
  const [school] = await tx.query<{
    id: SchoolId;
    name: string;
    time_zone: string;
    can_manage: boolean;
    can_see: boolean;
  }>(
    `SELECT id, name, time_zone, access.has_permission('catalog.manage', id) AS can_manage,
            access.has_permission('bookings.read', id) OR access.has_permission('catalog.read', id) AS can_see
       FROM org.school WHERE id = $1`,
    [schoolId],
  );
  if (!school?.can_see) return null;
  const offerings = await tx.query<{ id: string; name: string; has_route: boolean }>(
    `SELECT o.id, o.name, EXISTS (SELECT 1 FROM scheduling.transport_route r WHERE r.offering_id = o.id) AS has_route
       FROM catalog.school_offering o JOIN catalog.service_definition d ON d.id = o.service_definition_id
      WHERE o.school_id = $1 AND d.kind = 'transport' AND o.status <> 'archived'
      ORDER BY o.name`,
    [schoolId],
  );
  const routes = await findRoutes(
    tx,
    offerings.map((o) => o.id),
    true,
  );
  const terms = await tx.query<{
    id: string;
    offering_id: string;
    label: string | null;
    starts_at: Date;
    ends_at: Date | null;
    capacity: number | null;
    confirmed_count: number;
    reserved_count: number;
  }>(
    `SELECT s.id, s.offering_id, s.location_label AS label, s.starts_at, s.ends_at, s.capacity, s.confirmed_count, s.reserved_count
       FROM scheduling.session s
      WHERE s.offering_id = ANY ($1::uuid[]) AND s.status <> 'cancelled' AND s.starts_at IS NOT NULL
      ORDER BY s.starts_at`,
    [offerings.map((o) => o.id)],
  );
  return {
    school: { id: school.id, name: school.name, timeZone: school.time_zone },
    canManage: school.can_manage,
    offerings: offerings.map((offering) => ({
      id: offering.id,
      name: offering.name,
      route: routes.get(offering.id) ?? null,
      terms: terms
        .filter((term) => term.offering_id === offering.id)
        .map((term) => ({
          sessionId: term.id,
          label: term.label,
          startsAt: term.starts_at.toISOString(),
          endsAt: term.ends_at?.toISOString() ?? null,
          seats: term.capacity,
          taken: term.confirmed_count,
          awaitingPayment: term.reserved_count,
        })),
    })),
  };
}

export async function createRoute(
  tx: PersonTransaction,
  schoolId: string,
  body: { offeringId: string; vehicle?: string; weekdays: number[] },
): Promise<{ offeringId: string }> {
  const [offering] = await tx.query(
    'SELECT 1 FROM catalog.school_offering WHERE id = $1 AND school_id = $2',
    [body.offeringId, schoolId],
  );
  if (!offering) throw new TransportRejected(404, 'no such transport offering at this school');
  await tx.query(
    `INSERT INTO scheduling.transport_route (offering_id, group_id, school_id, vehicle, weekdays)
     VALUES ($1, access.current_group_id(), $2, $3, $4)`,
    [body.offeringId, schoolId, body.vehicle ?? null, body.weekdays],
  );
  return { offeringId: body.offeringId };
}

export async function addStop(
  tx: PersonTransaction,
  schoolId: string,
  offeringId: string,
  body: { name: string; pickupTime: string; dropoffTime?: string },
): Promise<{ id: string; position: number }> {
  const [route] = await tx.query(
    'SELECT 1 FROM scheduling.transport_route WHERE offering_id = $1 AND school_id = $2',
    [offeringId, schoolId],
  );
  if (!route) throw new TransportRejected(404, 'no such route at this school');
  const [row] = await tx.query<{ id: string; position: number }>(
    `INSERT INTO scheduling.transport_stop (group_id, school_id, offering_id, position, name, pickup_time, dropoff_time)
     SELECT access.current_group_id(), $1, $2, coalesce(max(position), 0) + 1, $3, $4, $5
       FROM scheduling.transport_stop WHERE offering_id = $2
     RETURNING id, position`,
    [schoolId, offeringId, body.name, body.pickupTime, body.dropoffTime ?? null],
  );
  return row!;
}

/** Each route running on a day at the viewer's schools, with who boards at each stop. */
export async function transportRuns(tx: PersonTransaction, date: string): Promise<TransportRuns> {
  const runs = await tx.query<{
    session_id: string;
    offering_id: string;
    name: string;
    school_id: SchoolId;
    school_name: string;
    term: string | null;
    capacity: number | null;
    confirmed_count: number;
  }>(
    `SELECT s.id AS session_id, o.id AS offering_id, o.name, sc.id AS school_id, sc.name AS school_name,
            s.location_label AS term, s.capacity, s.confirmed_count
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id AND d.kind = 'transport'
       JOIN scheduling.transport_route r ON r.offering_id = o.id
       JOIN org.school sc ON sc.id = s.school_id
      WHERE s.status <> 'cancelled' AND access.has_permission('bookings.read', s.school_id)
        AND $1::date >= (s.starts_at AT TIME ZONE sc.time_zone)::date
        AND $1::date < (s.ends_at AT TIME ZONE sc.time_zone)::date
        AND extract(isodow FROM $1::date)::smallint = ANY (r.weekdays)
      ORDER BY sc.name, o.name`,
    [date],
  );
  const routes = await findRoutes(
    tx,
    runs.map((run) => run.offering_id),
    true,
  );
  const riders = runs.length
    ? await tx.query<{
        session_id: string;
        transport_stop_id: string;
        given_name: string | null;
        family_name: string | null;
        class_label: string | null;
      }>(
        `SELECT b.session_id, b.transport_stop_id, p.given_name, p.family_name, e.class_label
           FROM scheduling.booking b
           LEFT JOIN people.person p ON p.id = b.student_person_id
           LEFT JOIN people.enrolment e ON e.student_person_id = b.student_person_id
                AND e.school_id = b.school_id AND e.status = 'active'
          WHERE b.session_id = ANY ($1::uuid[]) AND b.status IN ('confirmed', 'attended', 'absent')
          ORDER BY p.family_name, p.given_name`,
        [runs.map((run) => run.session_id)],
      )
    : [];
  return {
    date,
    routes: runs.map((run) => {
      const route = routes.get(run.offering_id)!;
      return {
        sessionId: run.session_id,
        name: run.name,
        school: { id: run.school_id, name: run.school_name },
        term: run.term,
        vehicle: route.vehicle,
        seats: run.capacity,
        riders: run.confirmed_count,
        stops: route.stops
          .filter((stop) => stop.active || riders.some((rider) => rider.transport_stop_id === stop.id))
          .map((stop) => ({
            name: stop.name,
            pickupTime: stop.pickupTime,
            dropoffTime: stop.dropoffTime,
            children: riders
              .filter((rider) => rider.session_id === run.session_id && rider.transport_stop_id === stop.id)
              .map((rider) => ({
                studentName: rider.given_name
                  ? [rider.given_name, rider.family_name].filter(Boolean).join(' ')
                  : null,
                classLabel: rider.class_label,
              })),
          })),
      };
    }),
  };
}
