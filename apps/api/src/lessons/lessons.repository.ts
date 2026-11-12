import { type PersonId, type SchoolId, type SchoolLessons, type StudentLessons } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Individual lessons (M4.3, ADR 0022). Teachers and rooms are resources with
// weekly availability; slots are lesson sessions that the database never lets
// overlap for a resource; families spend lessons from paid packages. The
// database functions decide who may book, cancel and create slots.

export class LessonsRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

/** Slots shown to a family: the next three weeks. */
const PARENT_DAYS = 21;

interface SlotRow {
  session_id: string;
  offering_id: string;
  offering_name: string;
  school_name: string;
  time_zone: string;
  starts_at: Date;
  ends_at: Date;
  teacher: string | null;
  room: string | null;
}

const SLOT_RESOURCES = `
  (SELECT r.display_name FROM scheduling.session_resource sr JOIN scheduling.resource r ON r.id = sr.resource_id
    WHERE sr.session_id = s.id AND r.kind = 'teacher') AS teacher,
  (SELECT r.display_name FROM scheduling.session_resource sr JOIN scheduling.resource r ON r.id = sr.resource_id
    WHERE sr.session_id = s.id AND r.kind = 'room') AS room`;

export async function studentLessons(
  tx: PersonTransaction,
  studentId: string,
): Promise<StudentLessons | null> {
  const [student] = await tx.query<{
    id: PersonId;
    given_name: string;
    family_name: string;
    can_book: boolean;
  }>(
    `SELECT id, given_name, family_name, access.is_guardian_of(id, 'manage_bookings') AS can_book
       FROM people.person WHERE id = $1 AND access.is_guardian_of(id, 'view')`,
    [studentId],
  );
  if (!student) return null;
  const packages = await tx.query<{
    id: string;
    offering_id: string;
    offering_name: string;
    school_name: string;
    lessons_bought: number;
    lessons_left: number;
    created_at: Date;
  }>(
    `SELECT p.id, p.offering_id, o.name AS offering_name, sc.name AS school_name, p.lessons_bought,
            scheduling.package_balance(p.id) AS lessons_left, p.created_at
       FROM scheduling.lesson_package p
       JOIN catalog.school_offering o ON o.id = p.offering_id
       JOIN org.school sc ON sc.id = p.school_id
      WHERE p.student_person_id = $1
      ORDER BY p.created_at`,
    [studentId],
  );
  const usable = packages.filter((p) => p.lessons_left > 0).map((p) => p.offering_id);
  const slots = usable.length
    ? await tx.query<SlotRow>(
        `SELECT s.id AS session_id, s.offering_id, o.name AS offering_name, sc.name AS school_name, sc.time_zone,
                s.starts_at, s.ends_at, ${SLOT_RESOURCES}
           FROM scheduling.session s
           JOIN catalog.school_offering o ON o.id = s.offering_id
           JOIN org.school sc ON sc.id = s.school_id
          WHERE s.offering_id = ANY ($1::uuid[]) AND s.status = 'scheduled'
            AND s.starts_at > now() AND s.starts_at < now() + make_interval(days => $2)
            AND (s.booking_cutoff_at IS NULL OR s.booking_cutoff_at > now())
            AND (s.capacity IS NULL OR s.reserved_count + s.confirmed_count < s.capacity)
          ORDER BY s.starts_at`,
        [usable, PARENT_DAYS],
      )
    : [];
  const bookings = await tx.query<
    SlotRow & { booking_id: string; status: string; cancellation_cutoff_at: Date | null }
  >(
    `SELECT b.id AS booking_id, b.status, s.id AS session_id, s.offering_id, o.name AS offering_name,
            sc.name AS school_name, sc.time_zone, s.starts_at, s.ends_at, s.cancellation_cutoff_at, ${SLOT_RESOURCES}
       FROM scheduling.booking b
       JOIN scheduling.package_entry e ON e.booking_id = b.id AND e.kind = 'booking'
       JOIN scheduling.session s ON s.id = b.session_id
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN org.school sc ON sc.id = s.school_id
      WHERE b.student_person_id = $1 AND b.status IN ('confirmed', 'attended', 'absent')
      ORDER BY s.starts_at`,
    [studentId],
  );
  const now = new Date();
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    canBook: student.can_book,
    packages: packages.map((p) => ({
      id: p.id,
      offeringId: p.offering_id,
      offeringName: p.offering_name,
      schoolName: p.school_name,
      lessonsBought: p.lessons_bought,
      lessonsLeft: p.lessons_left,
      boughtAt: p.created_at.toISOString(),
    })),
    slots: slots.map(slotView),
    bookings: bookings.map((b) => ({
      ...slotView(b),
      bookingId: b.booking_id,
      status: b.status as 'confirmed' | 'attended' | 'absent',
      canCancel: student.can_book && b.status === 'confirmed' && b.starts_at > now,
      cancelReturnsLesson: b.cancellation_cutoff_at === null || b.cancellation_cutoff_at > now,
      cancellationCutoffAt: b.cancellation_cutoff_at?.toISOString() ?? null,
    })),
  };
}

function slotView(row: SlotRow) {
  return {
    sessionId: row.session_id,
    offeringId: row.offering_id,
    offeringName: row.offering_name,
    schoolName: row.school_name,
    timeZone: row.time_zone,
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    teacher: row.teacher,
    room: row.room,
  };
}

const DATABASE_REFUSALS: Record<string, [LessonsRejected['status'], string]> = {
  P0002: [404, 'no such package or lesson for this child'],
  '23503': [422, 'this slot is not for the lessons in the package'],
  '23505': [409, 'already booked, or already exists'],
  PY002: [409, 'someone has just booked this slot'],
  PY007: [409, 'this slot is no longer open, or the lesson has started'],
  PY012: [422, 'the child may not take these lessons'],
  PY014: [409, 'the package has no lessons left'],
  '42501': [403, 'not permitted'],
  '23514': [422, 'a value is not allowed here'],
  '22023': [422, 'slots are 15-240 minutes, over at most 93 days'],
  PY015: [422, 'outside the availability of the teacher or room, or they are no longer in use'],
  '23P01': [409, 'the teacher or room is already taken then'],
};

/** Runs a lesson write, turning the database's refusals into answers the page can show. */
export async function refusalsAsLessons<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new LessonsRejected(refusal[0], refusal[1]);
    throw error;
  }
}

export async function bookLesson(
  tx: PersonTransaction,
  studentId: string,
  sessionId: string,
  packageId: string,
): Promise<{ bookingId: string }> {
  const [row] = await tx.query<{ id: string }>('SELECT scheduling.book_lesson($1, $2, $3) AS id', [
    sessionId,
    studentId,
    packageId,
  ]);
  return { bookingId: row!.id };
}

export async function cancelLesson(
  tx: PersonTransaction,
  studentId: string,
  bookingId: string,
): Promise<{ bookingId: string; outcome: 'returned' | 'used' }> {
  const [owned] = await tx.query(
    'SELECT 1 FROM scheduling.booking WHERE id = $1 AND student_person_id = $2',
    [bookingId, studentId],
  );
  if (!owned) throw new LessonsRejected(404, 'no such lesson for this child');
  const [row] = await tx.query<{ outcome: 'returned' | 'used' }>(
    'SELECT scheduling.cancel_lesson($1) AS outcome',
    [bookingId],
  );
  return { bookingId, outcome: row!.outcome };
}

// ------------------------------------------------------------------ staff

export async function schoolLessons(
  tx: PersonTransaction,
  schoolId: string,
  range: { from: string; days: number },
): Promise<SchoolLessons | null> {
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
  const resources = await tx.query<{
    id: string;
    kind: 'teacher' | 'room';
    display_name: string;
    status: string;
  }>(
    `SELECT id, kind, display_name, status FROM scheduling.resource WHERE school_id = $1 ORDER BY kind, display_name`,
    [schoolId],
  );
  const hours = await tx.query<{
    id: string;
    resource_id: string;
    weekday: number;
    starts: string;
    ends: string;
  }>(
    `SELECT id, resource_id, weekday, to_char(starts, 'HH24:MI') AS starts, to_char(ends, 'HH24:MI') AS ends
       FROM scheduling.resource_availability WHERE school_id = $1 ORDER BY weekday, starts`,
    [schoolId],
  );
  const offerings = await tx.query<{ id: string; name: string; package_size: number | null }>(
    `SELECT o.id, o.name, pv.package_size
       FROM catalog.school_offering o
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       LEFT JOIN LATERAL (SELECT package_size FROM catalog.price_version p
                           WHERE p.offering_id = o.id AND p.variant_id IS NULL
                             AND p.valid_from <= now() AND (p.valid_until IS NULL OR p.valid_until > now())
                           ORDER BY p.valid_from DESC LIMIT 1) pv ON true
      WHERE o.school_id = $1 AND d.kind = 'lesson' AND o.status <> 'archived'
      ORDER BY o.name`,
    [schoolId],
  );
  const slots = await tx.query<
    SlotRow & {
      status: string;
      booking_id: string | null;
      given_name: string | null;
      family_name: string | null;
    }
  >(
    `SELECT s.id AS session_id, s.offering_id, o.name AS offering_name, sc.name AS school_name, sc.time_zone,
            s.starts_at, s.ends_at, s.status, ${SLOT_RESOURCES}, b.id AS booking_id, p.given_name, p.family_name
       FROM scheduling.session s
       JOIN catalog.school_offering o ON o.id = s.offering_id
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       JOIN org.school sc ON sc.id = s.school_id
       LEFT JOIN scheduling.booking b ON b.session_id = s.id AND b.status IN ('reserved', 'confirmed', 'attended', 'absent')
       LEFT JOIN people.person p ON p.id = b.student_person_id
      WHERE s.school_id = $1 AND d.kind = 'lesson' AND s.status <> 'cancelled'
        AND (s.starts_at AT TIME ZONE sc.time_zone)::date BETWEEN $2::date AND $2::date + ($3::int - 1)
      ORDER BY s.starts_at`,
    [schoolId, range.from, range.days],
  );
  return {
    ...range,
    school: { id: school.id, name: school.name, timeZone: school.time_zone },
    canManage: school.can_manage,
    resources: resources.map((r) => ({
      id: r.id,
      kind: r.kind,
      displayName: r.display_name,
      active: r.status === 'active',
      hours: hours
        .filter((h) => h.resource_id === r.id)
        .map((h) => ({ id: h.id, weekday: h.weekday, starts: h.starts, ends: h.ends })),
    })),
    offerings: offerings.map((o) => ({ id: o.id, name: o.name, packageSize: o.package_size })),
    slots: slots.map((s) => ({
      ...slotView(s),
      booked: s.booking_id !== null,
      bookedFor: s.given_name ? `${s.given_name} ${s.family_name ?? ''}`.trim() : null,
    })),
  };
}

export async function addResource(
  tx: PersonTransaction,
  schoolId: string,
  body: { kind: 'teacher' | 'room'; displayName: string },
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO scheduling.resource (group_id, school_id, kind, display_name)
     VALUES (access.current_group_id(), $1, $2, $3) RETURNING id`,
    [schoolId, body.kind, body.displayName],
  );
  return { id: row!.id };
}

export async function addHours(
  tx: PersonTransaction,
  schoolId: string,
  resourceId: string,
  body: { weekday: number; starts: string; ends: string },
): Promise<{ id: string }> {
  const [resource] = await tx.query('SELECT 1 FROM scheduling.resource WHERE id = $1 AND school_id = $2', [
    resourceId,
    schoolId,
  ]);
  if (!resource) throw new LessonsRejected(404, 'no such teacher or room at this school');
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO scheduling.resource_availability (group_id, school_id, resource_id, weekday, starts, ends)
     VALUES (access.current_group_id(), $1, $2, $3, $4, $5) RETURNING id`,
    [schoolId, resourceId, body.weekday, body.starts, body.ends],
  );
  return { id: row!.id };
}

export async function removeHours(tx: PersonTransaction, schoolId: string, hoursId: string): Promise<void> {
  const removed = await tx.query(
    'DELETE FROM scheduling.resource_availability WHERE id = $1 AND school_id = $2 RETURNING id',
    [hoursId, schoolId],
  );
  if (!removed.length) throw new LessonsRejected(404, 'no such hours, or not yours to change');
}

export async function createSlots(
  tx: PersonTransaction,
  schoolId: string,
  body: { offeringId: string; teacherId: string; roomId: string; from: string; to: string; minutes: number },
): Promise<{ created: number }> {
  const [offering] = await tx.query(
    'SELECT 1 FROM catalog.school_offering WHERE id = $1 AND school_id = $2',
    [body.offeringId, schoolId],
  );
  if (!offering) throw new LessonsRejected(404, 'no such lesson offering at this school');
  const [row] = await tx.query<{ created: number }>(
    'SELECT scheduling.create_lesson_slots($1, $2, $3, $4, $5, $6) AS created',
    [body.offeringId, body.teacherId, body.roomId, body.from, body.to, body.minutes],
  );
  return { created: row!.created };
}
