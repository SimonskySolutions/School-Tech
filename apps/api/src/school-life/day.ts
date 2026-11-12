import {
  type ActivityRegisters,
  type KitchenCounts,
  type SchoolId,
  type SchoolLifeDay,
  type SchoolRequests,
  type SchoolUniforms,
  type TransportRuns,
  type TripParticipants,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';
import { schoolRequests } from '../requests/requests.repository';
import { transportRuns } from '../transport/transport.repository';
import { tripParticipants } from '../trips/trips.repository';
import { schoolUniforms } from '../uniforms/uniforms.repository';
import { activityRegisters, kitchenCounts } from './school-life.repository';

// One school on one day for School Life (M4.8): everything the M4 services
// need doing, from the read models each service already has, filtered to the
// school. Each part follows its own permissions, so a role sees only the
// parts it may see elsewhere; a part it may not see is null.

export interface DayParts {
  school: { id: SchoolId; name: string; timeZone: string };
  date: string;
  schools: { id: SchoolId; name: string }[];
  kitchen: KitchenCounts;
  registers: ActivityRegisters;
  trips: TripParticipants;
  transport: TransportRuns;
  uniforms: SchoolUniforms | null;
  requests: SchoolRequests | null;
  dietaryToVerify: number | null;
}

const MARKED = ['attended', 'absent'];

/** Pure: the day page's summary from the parts. */
export function summariseDay(parts: DayParts): SchoolLifeDay {
  const schoolId = parts.school.id;
  const kitchen = parts.kitchen.schools.find((entry) => entry.school.id === schoolId);
  const lunchDay = kitchen?.days.find((day) => day.date === parts.date);
  return {
    school: parts.school,
    date: parts.date,
    schools: parts.schools,
    lunch: lunchDay
      ? {
          meals: lunchDay.meals,
          awaitingPayment: lunchDay.awaitingPayment,
          capacity: lunchDay.capacity,
          dishes: lunchDay.menu.length,
          showsDietary: kitchen!.showsDietary,
          alerts: lunchDay.dietary.map((need) => ({
            studentName: need.studentName,
            classLabel: need.classLabel,
            kind: need.kind,
            severity: need.severity,
            description: need.description,
            onMenu: need.menuConflicts.map((conflict) => conflict.dish),
            verified: need.verified,
          })),
        }
      : null,
    sessions: parts.registers.sessions
      .filter((session) => session.school.id === schoolId)
      .map((session) => ({
        id: session.id,
        name: session.offering.name,
        startsAt: session.startsAt,
        endsAt: session.endsAt,
        location: session.location,
        booked: session.booked,
        marked: session.attendees.filter((attendee) => MARKED.includes(attendee.status)).length,
        canMark: session.canMark,
      })),
    trips: parts.trips.trips
      .filter((trip) => trip.school.id === schoolId)
      .map((trip) => ({
        sessionId: trip.sessionId,
        name: trip.name,
        startsAt: trip.startsAt,
        booked: trip.booked,
        capacity: trip.capacity,
        withoutPermission: trip.participants.filter((participant) => !participant.permission).length,
      })),
    transport: parts.transport.routes
      .filter((route) => route.school.id === schoolId)
      .map((route) => ({
        name: route.name,
        riders: route.riders,
        seats: route.seats,
        firstPickup: route.stops[0]?.pickupTime ?? null,
      })),
    uniforms: parts.uniforms
      ? {
          awaitingHandOver: parts.uniforms.awaitingHandOver.reduce((sum, item) => sum + item.quantity, 0),
          lowStock: parts.uniforms.products.flatMap((product) => product.variants).filter((v) => v.lowStock)
            .length,
        }
      : null,
    requests: parts.requests
      ? {
          waiting: parts.requests.requests.filter((r) => r.school.id === schoolId && r.status === 'open')
            .length,
          inProgress: parts.requests.requests.filter(
            (r) => r.school.id === schoolId && r.status === 'in_progress',
          ).length,
        }
      : null,
    dietaryToVerify: parts.dietaryToVerify,
  };
}

/**
 * The day at one school (the viewer's first school when none is named), or
 * null when the viewer may not see its bookings.
 */
export async function schoolLifeDay(
  tx: PersonTransaction,
  schoolId: string | null,
  date: string | null,
): Promise<SchoolLifeDay | null> {
  const schools = await tx.query<{ id: SchoolId; name: string }>(
    `SELECT id, name FROM org.school
      WHERE group_id = access.current_group_id() AND status = 'active' AND access.has_permission('bookings.read', id)
      ORDER BY name`,
  );
  const chosen = schoolId ?? schools[0]?.id;
  if (!chosen) return null;
  const [school] = await tx.query<{
    id: SchoolId;
    name: string;
    time_zone: string;
    today: string;
    requests: boolean;
    dietary: boolean;
  }>(
    `SELECT id, name, time_zone, to_char((now() AT TIME ZONE time_zone)::date, 'YYYY-MM-DD') AS today,
            access.has_permission('requests.manage', id) AS requests,
            access.has_permission('sensitive.dietary.read', id) AND access.has_permission('enrolment.read', id) AS dietary
       FROM org.school WHERE id = $1 AND access.has_permission('bookings.read', id)`,
    [chosen],
  );
  if (!school) return null;
  const day = date ?? school.today;
  const range = { from: day, days: 1 };
  // Only how many, never what they say: no dietary rows are read here.
  const [toVerify] = school.dietary
    ? await tx.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM sensitive.dietary_requirement dr
           JOIN people.enrolment e ON e.student_person_id = dr.student_person_id AND e.school_id = $1 AND e.status = 'active'
          WHERE dr.verified_at IS NULL AND (dr.valid_until IS NULL OR dr.valid_until >= current_date)`,
        [school.id],
      )
    : [];
  return summariseDay({
    school: { id: school.id, name: school.name, timeZone: school.time_zone },
    date: day,
    schools,
    kitchen: await kitchenCounts(tx, range),
    registers: await activityRegisters(tx, range),
    trips: await tripParticipants(tx, range),
    transport: await transportRuns(tx, day),
    uniforms: await schoolUniforms(tx, school.id),
    requests: school.requests ? await schoolRequests(tx, 'active') : null,
    dietaryToVerify: toVerify?.count ?? null,
  });
}
