import {
  type ActivityRegisters,
  type Allergen,
  type KitchenCounts,
  type PersonId,
  type SchoolId,
  type StudentActivities,
} from '@pythagoras/shared';
import { logSensitiveReads, readsPerChild } from '../common/access-log';
import { type PersonTransaction } from '../database/database';
import { dishesBySession, menuConflicts } from './menus';

// School Life read models: what the kitchen prepares and who is on each club
// register. Row-level security decides what each viewer gets: sessions and
// bookings need bookings.read at the school, names need people.read, classes
// enrolment.read, and dietary needs sensitive.dietary.read (ADR 0005, 0006).
// Every dietary row shown is written to the access log.
// Counts come from the session counters the booking triggers maintain.

/** Bookings that mean "this child is coming" (paid, or already registered). */
const BOOKED = ['confirmed', 'attended', 'absent'];

const SEVERITY_ORDER = ['life_threatening', 'severe', 'moderate', 'information'];

export interface DateRange {
  from: string;
  days: number;
}

/** The first day to show when none is asked for: today where the group's schools are. */
export async function defaultFrom(tx: PersonTransaction): Promise<string> {
  const [row] = await tx.query<{ today: string }>(
    `SELECT to_char(coalesce(min((now() AT TIME ZONE time_zone)::date), current_date), 'YYYY-MM-DD') AS today
       FROM org.school WHERE group_id = access.current_group_id()`,
  );
  return row!.today;
}

interface KitchenSessionRow {
  id: string;
  school_id: SchoolId;
  school_name: string;
  time_zone: string;
  service_date: string;
  confirmed_count: number;
  reserved_count: number;
  capacity: number | null;
  shows_dietary: boolean;
}

interface DietaryRow {
  session_id: string;
  student_person_id: string;
  school_id: string;
  given_name: string | null;
  family_name: string | null;
  class_label: string | null;
  kind: string;
  severity: string | null;
  description: string;
  allergens: Allergen[];
  verified: boolean;
}

export async function kitchenCounts(tx: PersonTransaction, range: DateRange): Promise<KitchenCounts> {
  const sessions = await tx.query<KitchenSessionRow>(
    `SELECT s.id, s.school_id, sc.name AS school_name, sc.time_zone,
            to_char(s.service_date, 'YYYY-MM-DD') AS service_date,
            s.confirmed_count, s.reserved_count, s.capacity,
            access.has_permission('sensitive.dietary.read', s.school_id) AS shows_dietary
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       JOIN org.school sc ON sc.id = s.school_id
      WHERE d.kind = 'lunch' AND s.status <> 'cancelled'
        AND access.has_permission('bookings.read', s.school_id)
        AND s.service_date BETWEEN $1::date AND $1::date + ($2::int - 1)
      ORDER BY sc.name, s.service_date`,
    [range.from, range.days],
  );
  const dietary = sessions.length
    ? await tx.query<DietaryRow>(
        `SELECT b.session_id, b.student_person_id, b.school_id, p.given_name, p.family_name, e.class_label,
                dr.kind, dr.severity, dr.description, dr.allergens, dr.verified_at IS NOT NULL AS verified
           FROM scheduling.booking b
           JOIN scheduling.session s ON s.id = b.session_id
           JOIN sensitive.dietary_requirement dr ON dr.student_person_id = b.student_person_id
                AND dr.valid_from <= s.service_date AND (dr.valid_until IS NULL OR dr.valid_until >= s.service_date)
           LEFT JOIN people.person p ON p.id = b.student_person_id
           LEFT JOIN people.enrolment e ON e.student_person_id = b.student_person_id
                AND e.school_id = b.school_id AND e.status = 'active'
          WHERE b.session_id = ANY ($1::uuid[]) AND b.status = ANY ($2::text[])
          ORDER BY p.family_name, p.given_name`,
        [sessions.map((session) => session.id), BOOKED],
      )
    : [];
  await logSensitiveReads(tx, 'sensitive.dietary_requirement:kitchen', readsPerChild(dietary));
  const menus = await dishesBySession(
    tx,
    sessions.map((session) => session.id),
  );

  const schools = new Map<string, KitchenCounts['schools'][number]>();
  for (const session of sessions) {
    const school = schools.get(session.school_id) ?? {
      school: { id: session.school_id, name: session.school_name, timeZone: session.time_zone },
      showsDietary: session.shows_dietary,
      days: [],
    };
    // A school may serve more than one lunch offering on a day; the kitchen cooks for all of them.
    let day = school.days.find((entry) => entry.date === session.service_date);
    if (!day) {
      day = { date: session.service_date, meals: 0, awaitingPayment: 0, capacity: 0, menu: [], dietary: [] };
      school.days.push(day);
    }
    day.meals += session.confirmed_count;
    day.awaitingPayment += session.reserved_count;
    day.capacity =
      day.capacity === null || session.capacity === null ? null : day.capacity + session.capacity;
    const menu = menus.get(session.id) ?? [];
    day.menu.push(...menu);
    day.dietary.push(
      ...dietary
        .filter((row) => row.session_id === session.id)
        .map((row) => ({
          studentName: fullName(row),
          classLabel: row.class_label,
          kind: row.kind,
          severity: row.severity,
          description: row.description,
          allergens: row.allergens,
          verified: row.verified,
          // Against the menu of the lunch this child is booked on.
          menuConflicts: menuConflicts(menu, row.allergens),
        })),
    );
    schools.set(session.school_id, school);
  }
  for (const school of schools.values()) {
    for (const day of school.days) day.dietary.sort(byDanger);
  }
  return { ...range, schools: [...schools.values()] };
}

interface RegisterSessionRow {
  id: string;
  offering_id: string;
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
  can_mark: boolean;
}

interface AttendeeRow {
  booking_id: string;
  session_id: string;
  given_name: string | null;
  family_name: string | null;
  class_label: string | null;
  status: string;
}

export async function activityRegisters(tx: PersonTransaction, range: DateRange): Promise<ActivityRegisters> {
  const sessions = await tx.query<RegisterSessionRow>(
    `SELECT s.id, o.id AS offering_id, o.name AS offering_name, s.school_id, sc.name AS school_name, sc.time_zone,
            s.starts_at, s.ends_at, s.location_label, s.capacity, s.confirmed_count, s.reserved_count,
            (s.starts_at <= now() AND access.has_permission('attendance.mark', s.school_id)) AS can_mark
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       JOIN org.school sc ON sc.id = s.school_id
      WHERE d.kind IN ('activity', 'lesson') AND s.status <> 'cancelled' AND s.starts_at IS NOT NULL
        AND access.has_permission('bookings.read', s.school_id)
        AND (d.kind = 'activity' OR s.confirmed_count + s.reserved_count > 0)
        AND (s.starts_at AT TIME ZONE sc.time_zone)::date BETWEEN $1::date AND $1::date + ($2::int - 1)
      ORDER BY s.starts_at, o.name`,
    [range.from, range.days],
  );
  const attendees = sessions.length
    ? await tx.query<AttendeeRow>(
        `SELECT b.id AS booking_id, b.session_id, p.given_name, p.family_name, e.class_label, b.status
           FROM scheduling.booking b
           LEFT JOIN people.person p ON p.id = b.student_person_id
           LEFT JOIN people.enrolment e ON e.student_person_id = b.student_person_id
                AND e.school_id = b.school_id AND e.status = 'active'
          WHERE b.session_id = ANY ($1::uuid[]) AND b.status = ANY ($2::text[])
          ORDER BY p.family_name, p.given_name`,
        [sessions.map((session) => session.id), BOOKED],
      )
    : [];

  return {
    ...range,
    sessions: sessions.map((session) => ({
      id: session.id,
      offering: { id: session.offering_id, name: session.offering_name },
      school: { id: session.school_id, name: session.school_name, timeZone: session.time_zone },
      startsAt: session.starts_at.toISOString(),
      endsAt: session.ends_at?.toISOString() ?? null,
      location: session.location_label,
      capacity: session.capacity,
      booked: session.confirmed_count,
      awaitingPayment: session.reserved_count,
      canMark: session.can_mark,
      attendees: attendees
        .filter((row) => row.session_id === session.id)
        .map((row) => ({
          bookingId: row.booking_id,
          studentName: fullName(row),
          classLabel: row.class_label,
          status: row.status,
        })),
    })),
  };
}

function fullName(row: { given_name: string | null; family_name: string | null }): string | null {
  return row.given_name ? [row.given_name, row.family_name].filter(Boolean).join(' ') : null;
}

/** A child whose allergen is on that day's menu first, then by severity. */
export function byDanger(
  a: { severity: string | null; menuConflicts: readonly unknown[] },
  b: { severity: string | null; menuConflicts: readonly unknown[] },
): number {
  const conflict = Number(b.menuConflicts.length > 0) - Number(a.menuConflicts.length > 0);
  return conflict || bySeverity(a, b);
}

/** Most dangerous first, so a life-threatening allergy is never at the bottom of the list. */
export function bySeverity(a: { severity: string | null }, b: { severity: string | null }): number {
  const rank = (severity: string | null) => {
    const index = SEVERITY_ORDER.indexOf(severity ?? '');
    return index === -1 ? SEVERITY_ORDER.length : index;
  };
  return rank(a.severity) - rank(b.severity);
}

/** Club meetings a guardian's child is booked on (paid), with attendance; null if not their child. */
export async function studentActivities(
  tx: PersonTransaction,
  studentId: string,
): Promise<StudentActivities | null> {
  const [student] = await tx.query<{ id: PersonId; given_name: string; family_name: string }>(
    `SELECT id, given_name, family_name FROM people.person WHERE id = $1 AND access.is_guardian_of(id, 'view')`,
    [studentId],
  );
  if (!student) return null;
  const rows = await tx.query<{
    offering_name: string;
    school_name: string;
    time_zone: string;
    starts_at: Date;
    ends_at: Date | null;
    location_label: string | null;
    started: boolean;
    status: 'confirmed' | 'attended' | 'absent';
  }>(
    `SELECT o.name AS offering_name, sc.name AS school_name, sc.time_zone, s.starts_at, s.ends_at, s.location_label,
            s.starts_at <= now() AS started, b.status
       FROM scheduling.booking b
       JOIN scheduling.session s ON s.id = b.session_id
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       JOIN org.school sc ON sc.id = s.school_id
      WHERE b.student_person_id = $1 AND d.kind = 'activity' AND s.starts_at IS NOT NULL
        AND b.status = ANY ($2::text[])
      ORDER BY s.starts_at, o.name`,
    [studentId, BOOKED],
  );
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    sessions: rows.map((row) => ({
      offeringName: row.offering_name,
      schoolName: row.school_name,
      timeZone: row.time_zone,
      startsAt: row.starts_at.toISOString(),
      endsAt: row.ends_at?.toISOString() ?? null,
      location: row.location_label,
      started: row.started,
      status: row.status,
    })),
  };
}
