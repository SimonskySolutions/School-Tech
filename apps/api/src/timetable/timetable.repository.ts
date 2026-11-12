import {
  type ClassDetail,
  type SchoolClasses,
  type SchoolTimetable,
  type StudentTimetable,
  type TimetableEntry,
  type TimetablePeriod,
  type TimetableView,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Classes and the weekly timetable. The database keeps the promises: a class
// never goes over its limit, and a class, teacher or room is never in two
// places in one period. This module reads them and turns refusals into answers.

export class TimetableRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

/** The school year a day belongs to; it turns over in August, before the September start. */
export function academicYearOf(day: Date): string {
  const year = day.getUTCFullYear();
  return day.getUTCMonth() >= 7 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

const CONSTRAINTS: Record<string, string> = {
  timetable_class_free: 'this class already has a lesson in that period',
  timetable_teacher_free: 'this teacher already teaches in that period',
  timetable_room_free: 'this room is already in use in that period',
  school_class_school_id_academic_year_label_key: 'a class of this name already exists this year',
  timetable_period_school_id_position_key: 'this period already exists',
};

const DATABASE_REFUSALS: Record<string, [TimetableRejected['status'], string]> = {
  PY027: [409, 'this class is full'],
  PY028: [422, 'choose a teacher and a room that are in use at this school'],
  '42501': [403, 'not permitted'],
  '23503': [422, 'choose a class, period, teacher and room of this school'],
  '23514': [422, 'a value is not allowed here'],
};

/** Runs a write, turning the database's refusals into answers the page can show. */
export async function refusalsAsTimetable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const { code, constraint } = (error ?? {}) as { code?: unknown; constraint?: unknown };
    if (code === '23505') {
      throw new TimetableRejected(409, CONSTRAINTS[String(constraint)] ?? 'this already exists');
    }
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new TimetableRejected(refusal[0], refusal[1]);
    throw error;
  }
}

interface School {
  id: string;
  name: string;
  group_id: string;
  can_manage: boolean;
  can_teach: boolean;
}

async function school(tx: PersonTransaction, schoolId: string): Promise<School> {
  const [row] = await tx.query<School>(
    `SELECT id, name, group_id, access.has_permission('timetable.manage', id) AS can_manage,
            access.has_permission('class.teach', id) AS can_teach
       FROM org.school
      WHERE id = $1 AND (access.has_permission('enrolment.read', id) OR access.has_permission('timetable.manage', id))`,
    [schoolId],
  );
  if (!row) throw new TimetableRejected(404, 'no such school, or not yours to see');
  return row;
}

async function resources(tx: PersonTransaction, schoolId: string) {
  const rows = await tx.query<{ id: string; kind: string; display_name: string }>(
    `SELECT id, kind, display_name FROM scheduling.resource
      WHERE school_id = $1 AND status = 'active' ORDER BY display_name`,
    [schoolId],
  );
  const named = (kind: string) =>
    rows.filter((r) => r.kind === kind).map((r) => ({ id: r.id, name: r.display_name }));
  return { teachers: named('teacher'), rooms: named('room') };
}

interface ClassRow {
  id: string;
  label: string;
  grade_level: string;
  capacity: number;
  seats_taken: number;
  form_teacher_id: string | null;
  form_teacher: string | null;
  home_room_id: string | null;
  home_room: string | null;
}

const CLASSES = `
  SELECT c.id, c.label, c.grade_level, c.capacity,
         (SELECT count(*)::int FROM people.enrolment e
           WHERE e.class_id = c.id AND e.status IN ('active', 'suspended')) AS seats_taken,
         c.form_teacher_id, t.display_name AS form_teacher, c.home_room_id, r.display_name AS home_room
    FROM scheduling.school_class c
    LEFT JOIN scheduling.resource t ON t.id = c.form_teacher_id
    LEFT JOIN scheduling.resource r ON r.id = c.home_room_id`;

const classView = (row: ClassRow) => ({
  id: row.id,
  label: row.label,
  gradeLevel: row.grade_level,
  capacity: row.capacity,
  seatsTaken: row.seats_taken,
  formTeacherId: row.form_teacher_id,
  formTeacher: row.form_teacher,
  homeRoomId: row.home_room_id,
  homeRoom: row.home_room,
});

export async function schoolClasses(
  tx: PersonTransaction,
  schoolId: string,
  academicYear: string,
): Promise<SchoolClasses> {
  const found = await school(tx, schoolId);
  const classes = await tx.query<ClassRow>(
    `${CLASSES}
     WHERE c.school_id = $1 AND c.academic_year = $2 AND c.status = 'active'
     ORDER BY length(c.label), c.label`,
    [schoolId, academicYear],
  );
  const unplaced = await tx.query<{ id: string; given_name: string; family_name: string }>(
    `SELECT e.id, p.given_name, p.family_name
       FROM people.enrolment e
       JOIN people.person p ON p.id = e.student_person_id
      WHERE e.school_id = $1 AND e.academic_year = $2 AND e.class_id IS NULL AND e.status = 'active'
      ORDER BY p.family_name, p.given_name`,
    [schoolId, academicYear],
  );
  return {
    school: { id: found.id, name: found.name },
    academicYear,
    canManage: found.can_manage,
    classes: classes.map(classView),
    unplaced: unplaced.map((u) => ({ enrolmentId: u.id, name: `${u.given_name} ${u.family_name}` })),
    ...(await resources(tx, schoolId)),
  };
}

export async function classDetail(
  tx: PersonTransaction,
  schoolId: string,
  classId: string,
): Promise<ClassDetail> {
  const found = await school(tx, schoolId);
  const [row] = await tx.query<ClassRow>(`${CLASSES} WHERE c.id = $1 AND c.school_id = $2`, [
    classId,
    schoolId,
  ]);
  if (!row) throw new TimetableRejected(404, 'no such class');
  const students = await tx.query<{
    id: string;
    student_person_id: string;
    given_name: string;
    family_name: string;
  }>(
    `SELECT e.id, e.student_person_id, p.given_name, p.family_name
       FROM people.enrolment e
       JOIN people.person p ON p.id = e.student_person_id
      WHERE e.class_id = $1 AND e.status IN ('active', 'suspended')
      ORDER BY p.family_name, p.given_name`,
    [classId],
  );
  const unplaced = await tx.query<{ id: string; given_name: string; family_name: string }>(
    `SELECT e.id, p.given_name, p.family_name
       FROM people.enrolment e
       JOIN people.person p ON p.id = e.student_person_id
       JOIN scheduling.school_class c ON c.id = $1 AND c.school_id = e.school_id AND c.academic_year = e.academic_year
      WHERE e.class_id IS NULL AND e.status = 'active'
      ORDER BY p.family_name, p.given_name`,
    [classId],
  );
  return {
    school: { id: found.id, name: found.name },
    canManage: found.can_manage,
    canTeach: found.can_teach,
    class: classView(row),
    students: students.map((s) => ({
      enrolmentId: s.id,
      studentId: s.student_person_id,
      name: `${s.given_name} ${s.family_name}`,
    })),
    unplaced: unplaced.map((u) => ({ enrolmentId: u.id, name: `${u.given_name} ${u.family_name}` })),
    ...(await resources(tx, schoolId)),
  };
}

export async function addClass(
  tx: PersonTransaction,
  schoolId: string,
  academicYear: string,
  data: {
    label: string;
    gradeLevel: string;
    capacity: number;
    formTeacherId: string | null;
    homeRoomId: string | null;
  },
): Promise<{ id: string }> {
  const found = await school(tx, schoolId);
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO scheduling.school_class
       (group_id, school_id, academic_year, grade_level, label, capacity, form_teacher_id, home_room_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      found.group_id,
      schoolId,
      academicYear,
      data.gradeLevel,
      data.label,
      data.capacity,
      data.formTeacherId,
      data.homeRoomId,
    ],
  );
  // Children already enrolled under this label find their seat.
  await tx.query(
    `UPDATE people.enrolment SET class_label = class_label
      WHERE school_id = $1 AND academic_year = $2 AND class_label = $3 AND class_id IS NULL`,
    [schoolId, academicYear, data.label],
  );
  return row!;
}

export async function changeClass(
  tx: PersonTransaction,
  schoolId: string,
  classId: string,
  data: { capacity: number; formTeacherId: string | null; homeRoomId: string | null },
): Promise<void> {
  const rows = await tx.query(
    `UPDATE scheduling.school_class SET capacity = $3, form_teacher_id = $4, home_room_id = $5
      WHERE id = $1 AND school_id = $2 RETURNING id`,
    [classId, schoolId, data.capacity, data.formTeacherId, data.homeRoomId],
  );
  if (rows.length === 0) throw new TimetableRejected(404, 'no such class');
}

export async function placeStudent(
  tx: PersonTransaction,
  schoolId: string,
  classId: string,
  enrolmentId: string,
): Promise<void> {
  const rows = await tx.query(
    `UPDATE people.enrolment e SET class_id = c.id
       FROM scheduling.school_class c
      WHERE e.id = $1 AND e.school_id = $2 AND c.id = $3 AND c.school_id = e.school_id
        AND c.academic_year = e.academic_year
      RETURNING e.id`,
    [enrolmentId, schoolId, classId],
  );
  if (rows.length === 0) throw new TimetableRejected(404, 'no such child at this school this year');
}

interface PeriodRow {
  id: string;
  position: number;
  starts: string;
  ends: string;
}

const periodView = (row: PeriodRow): TimetablePeriod => ({
  id: row.id,
  position: row.position,
  starts: row.starts,
  ends: row.ends,
});

async function periods(tx: PersonTransaction, schoolId: string): Promise<TimetablePeriod[]> {
  const rows = await tx.query<PeriodRow>(
    `SELECT id, position, to_char(starts, 'HH24:MI') AS starts, to_char(ends, 'HH24:MI') AS ends
       FROM scheduling.timetable_period WHERE school_id = $1 ORDER BY position`,
    [schoolId],
  );
  return rows.map(periodView);
}

interface EntryRow {
  id: string;
  weekday: number;
  period_id: string;
  subject: string;
  class_id: string;
  class_label: string;
  teacher_id: string;
  teacher: string;
  room_id: string;
  room: string;
}

const ENTRIES = `
  SELECT en.id, en.weekday, en.period_id, en.subject, en.class_id, c.label AS class_label,
         en.teacher_id, t.display_name AS teacher, en.room_id, r.display_name AS room
    FROM scheduling.timetable_entry en
    JOIN scheduling.school_class c ON c.id = en.class_id
    JOIN scheduling.resource t ON t.id = en.teacher_id
    JOIN scheduling.resource r ON r.id = en.room_id`;

const entryView = (row: EntryRow): TimetableEntry => ({
  id: row.id,
  weekday: row.weekday,
  periodId: row.period_id,
  subject: row.subject,
  classId: row.class_id,
  classLabel: row.class_label,
  teacherId: row.teacher_id,
  teacher: row.teacher,
  roomId: row.room_id,
  room: row.room,
});

const VIEW_COLUMN: Record<TimetableView, string> = {
  class: 'en.class_id',
  teacher: 'en.teacher_id',
  room: 'en.room_id',
};

export async function schoolTimetable(
  tx: PersonTransaction,
  schoolId: string,
  academicYear: string,
  view: TimetableView,
  selected: string | undefined,
): Promise<SchoolTimetable> {
  const found = await school(tx, schoolId);
  const classes = await tx.query<{ id: string; label: string }>(
    `SELECT id, label FROM scheduling.school_class
      WHERE school_id = $1 AND academic_year = $2 AND status = 'active' ORDER BY length(label), label`,
    [schoolId, academicYear],
  );
  const staff = await resources(tx, schoolId);
  const choices =
    view === 'class'
      ? classes.map((c) => ({ id: c.id, name: c.label }))
      : view === 'teacher'
        ? staff.teachers
        : staff.rooms;
  const selectedId = choices.some((c) => c.id === selected) ? selected! : (choices[0]?.id ?? null);
  const entries = selectedId
    ? await tx.query<EntryRow>(
        `${ENTRIES} WHERE en.school_id = $1 AND en.academic_year = $2 AND ${VIEW_COLUMN[view]} = $3
         ORDER BY en.weekday`,
        [schoolId, academicYear, selectedId],
      )
    : [];
  return {
    school: { id: found.id, name: found.name },
    academicYear,
    canManage: found.can_manage,
    view,
    choices,
    selectedId,
    periods: await periods(tx, schoolId),
    classes: classes.map((c) => ({ id: c.id, name: c.label })),
    entries: entries.map(entryView),
    ...staff,
  };
}

export async function addPeriod(
  tx: PersonTransaction,
  schoolId: string,
  data: { position: number; starts: string; ends: string },
): Promise<{ id: string }> {
  const found = await school(tx, schoolId);
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO scheduling.timetable_period (group_id, school_id, position, starts, ends)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [found.group_id, schoolId, data.position, data.starts, data.ends],
  );
  return row!;
}

export async function addEntry(
  tx: PersonTransaction,
  schoolId: string,
  academicYear: string,
  data: {
    classId: string;
    weekday: number;
    periodId: string;
    subject: string;
    teacherId: string;
    roomId: string;
  },
): Promise<{ id: string }> {
  const found = await school(tx, schoolId);
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO scheduling.timetable_entry
       (group_id, school_id, academic_year, class_id, weekday, period_id, subject, teacher_id, room_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [
      found.group_id,
      schoolId,
      academicYear,
      data.classId,
      data.weekday,
      data.periodId,
      data.subject,
      data.teacherId,
      data.roomId,
    ],
  );
  return row!;
}

export async function removeEntry(tx: PersonTransaction, schoolId: string, entryId: string): Promise<void> {
  const rows = await tx.query(
    `DELETE FROM scheduling.timetable_entry WHERE id = $1 AND school_id = $2 RETURNING id`,
    [entryId, schoolId],
  );
  if (rows.length === 0) throw new TimetableRejected(404, 'no such lesson');
}

/** A child's week, for the family. */
export async function studentTimetable(
  tx: PersonTransaction,
  studentId: string,
  academicYear: string,
): Promise<StudentTimetable | null> {
  const [student] = await tx.query<{
    id: string;
    given_name: string;
    family_name: string;
    class_id: string | null;
    class_label: string | null;
    school_id: string | null;
    school_name: string | null;
  }>(
    `SELECT p.id, p.given_name, p.family_name, e.class_id, e.class_label, e.school_id, s.name AS school_name
       FROM people.person p
       LEFT JOIN people.enrolment e ON e.student_person_id = p.id AND e.academic_year = $2
                                   AND e.status = 'active' AND e.class_id IS NOT NULL
       LEFT JOIN org.school s ON s.id = e.school_id
      WHERE p.id = $1 AND access.is_guardian_of(p.id, 'view')
      LIMIT 1`,
    [studentId, academicYear],
  );
  if (!student) return null;
  const entries = student.class_id
    ? await tx.query<EntryRow>(`${ENTRIES} WHERE en.class_id = $1 ORDER BY en.weekday`, [student.class_id])
    : [];
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    academicYear,
    schoolName: student.school_name,
    classLabel: student.class_label,
    periods: student.school_id ? await periods(tx, student.school_id) : [],
    entries: entries.map(entryView),
  };
}
