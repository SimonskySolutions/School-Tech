import { type AttendanceStatus, type ClassRegister, type StudentProgress } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// The daily class register and grades. Row-level security decides who sees and
// keeps them; the database refuses a mark for a child outside the class.

export class AcademicRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [AcademicRejected['status'], string]> = {
  PY029: [422, 'this child is not in this class'],
  '42501': [403, 'not permitted'],
  '23514': [422, 'a value is not allowed here'],
};

/** Runs a write, turning the database's refusals into answers the page can show. */
export async function refusalsAsAcademic<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (refusal) throw new AcademicRejected(refusal[0], refusal[1]);
    throw error;
  }
}

/** The mean of a child's grades, to two places, as schools report it. */
export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

interface GradeRow {
  id: string;
  student_person_id: string;
  subject: string;
  term: number;
  value: number;
  given_on: string;
}

const GRADES = `
  SELECT g.id, g.student_person_id, g.subject, g.term, g.value, to_char(g.given_on, 'YYYY-MM-DD') AS given_on
    FROM academic.grade g`;

const gradeView = (row: GradeRow) => ({
  id: row.id,
  subject: row.subject,
  term: row.term,
  value: row.value,
  givenOn: row.given_on,
});

export async function classRegister(
  tx: PersonTransaction,
  schoolId: string,
  classId: string,
  day: string,
): Promise<ClassRegister> {
  const [found] = await tx.query<{ school_name: string; label: string; can_keep: boolean }>(
    `SELECT s.name AS school_name, c.label, access.has_permission('class.teach', s.id) AS can_keep
       FROM scheduling.school_class c
       JOIN org.school s ON s.id = c.school_id
      WHERE c.id = $1 AND c.school_id = $2 AND access.has_permission('class.teach', s.id)`,
    [classId, schoolId],
  );
  if (!found) throw new AcademicRejected(404, 'no such class, or not yours to keep');
  const students = await tx.query<{
    student_person_id: string;
    given_name: string;
    family_name: string;
    status: AttendanceStatus | null;
  }>(
    `SELECT e.student_person_id, p.given_name, p.family_name, a.status
       FROM people.enrolment e
       JOIN people.person p ON p.id = e.student_person_id
       LEFT JOIN academic.attendance a
         ON a.class_id = e.class_id AND a.student_person_id = e.student_person_id AND a.day = $2
      WHERE e.class_id = $1 AND e.status IN ('active', 'suspended')
      ORDER BY p.family_name, p.given_name`,
    [classId, day],
  );
  const grades = await tx.query<GradeRow>(`${GRADES} WHERE g.class_id = $1 ORDER BY g.given_on, g.id`, [
    classId,
  ]);
  const subjects = await tx.query<{ subject: string }>(
    `SELECT DISTINCT subject FROM scheduling.timetable_entry WHERE class_id = $1 ORDER BY subject`,
    [classId],
  );
  return {
    school: { id: schoolId, name: found.school_name },
    class: { id: classId, label: found.label },
    day,
    subjects: subjects.map((s) => s.subject),
    students: students.map((student) => {
      const own = grades.filter((g) => g.student_person_id === student.student_person_id);
      return {
        studentId: student.student_person_id,
        name: `${student.given_name} ${student.family_name}`,
        status: student.status,
        grades: own.map(gradeView),
        average: average(own.map((g) => g.value)),
      };
    }),
  };
}

export async function saveRegister(
  tx: PersonTransaction,
  schoolId: string,
  classId: string,
  data: { day: string; marks: { studentId: string; status: AttendanceStatus }[] },
): Promise<void> {
  await tx.query(
    `INSERT INTO academic.attendance (group_id, school_id, class_id, student_person_id, day, status, marked_by)
     SELECT c.group_id, c.school_id, c.id, mark.student, $3, mark.status, app.current_person_id()
       FROM scheduling.school_class c
      CROSS JOIN unnest($4::uuid[], $5::text[]) AS mark (student, status)
      WHERE c.id = $1 AND c.school_id = $2
     ON CONFLICT (class_id, student_person_id, day)
     DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by`,
    [
      classId,
      schoolId,
      data.day,
      data.marks.map((mark) => mark.studentId),
      data.marks.map((mark) => mark.status),
    ],
  );
}

export async function addGrade(
  tx: PersonTransaction,
  schoolId: string,
  classId: string,
  data: { studentId: string; subject: string; term: number; value: number },
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO academic.grade (group_id, school_id, class_id, student_person_id, subject, term, value, given_by)
     SELECT c.group_id, c.school_id, c.id, $3, $4, $5, $6, app.current_person_id()
       FROM scheduling.school_class c WHERE c.id = $1 AND c.school_id = $2
     RETURNING id`,
    [classId, schoolId, data.studentId, data.subject, data.term, data.value],
  );
  if (!row) throw new AcademicRejected(404, 'no such class');
  return row;
}

/** A child's register and grades this school year, for the family. */
export async function studentProgress(
  tx: PersonTransaction,
  studentId: string,
  academicYear: string,
): Promise<StudentProgress | null> {
  const [student] = await tx.query<{ id: string; given_name: string; family_name: string }>(
    `SELECT id, given_name, family_name FROM people.person
      WHERE id = $1 AND access.is_guardian_of(id, 'view')`,
    [studentId],
  );
  if (!student) return null;
  const marks = await tx.query<{ day: string; status: AttendanceStatus }>(
    `SELECT to_char(a.day, 'YYYY-MM-DD') AS day, a.status
       FROM academic.attendance a
       JOIN scheduling.school_class c ON c.id = a.class_id
      WHERE a.student_person_id = $1 AND c.academic_year = $2
      ORDER BY a.day DESC`,
    [studentId, academicYear],
  );
  const grades = await tx.query<GradeRow>(
    `${GRADES}
       JOIN scheduling.school_class c ON c.id = g.class_id
      WHERE g.student_person_id = $1 AND c.academic_year = $2
      ORDER BY g.subject, g.given_on, g.id`,
    [studentId, academicYear],
  );
  const count = (status: AttendanceStatus) => marks.filter((mark) => mark.status === status).length;
  const subjects = [...new Set(grades.map((grade) => grade.subject))];
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    academicYear,
    attendance: {
      present: count('present'),
      late: count('late'),
      absent: count('absent'),
      excused: count('excused'),
    },
    missed: marks.filter((mark) => mark.status !== 'present').slice(0, 10),
    subjects: subjects.map((subject) => {
      const own = grades.filter((grade) => grade.subject === subject);
      return { subject, grades: own.map(gradeView), average: average(own.map((g) => g.value)) };
    }),
  };
}
