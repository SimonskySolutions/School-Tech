import { type AttendanceStatus } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ACADEMIC_NOTICES, ATTENDANCE_NAMES, GRADE_NAMES, readDay } from '../../../../../../lib/academic';
import { fetchClassRegister } from '../../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../../lib/server';
import { DevelopmentBanner } from '../../../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string; classId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MARKS = Object.keys(ATTENDANCE_NAMES) as AttendanceStatus[];

/** One class's register for a day, and its grades, for those who teach it. */
export default async function ClassRegisterPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id, classId } = await params;
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const day = readDay(query.day, new Date().toISOString().slice(0, 10));
  const result = await fetchClassRegister(config.API_INTERNAL_URL, session.accessToken, id, classId, day);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Register</h1>
        <p data-testid="not-permitted">This page is for those who teach at the school.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (ACADEMIC_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const classPath = `/schools/${view.school.id}/classes/${view.class.id}`;
  const action = `${classPath}/register/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href={classPath}>{`Class ${view.class.label}`}</Link>
      </p>
      <h1>{`Register of ${view.class.label}`}</h1>
      {done ? (
        <p role="status" data-testid="done">
          {done}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="error">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="register" data-testid="register">
        <h2 id="register">{`Attendance on ${view.day}`}</h2>
        <form method="get" className="form-row">
          <label>
            Day <input type="date" name="day" defaultValue={view.day} />
          </label>
          <button type="submit" className="button soft">
            Show
          </button>
        </form>
        {view.students.length === 0 ? <p>No children in this class yet.</p> : null}
        {view.students.length > 0 ? (
          <form method="post" action={action}>
            <input type="hidden" name="action" value="save-register" />
            <input type="hidden" name="day" value={view.day} />
            <ul className="register">
              {view.students.map((student) => (
                <li key={student.studentId} data-testid={`register-${student.studentId}`}>
                  <span>{student.name}</span>
                  <fieldset className="marks">
                    <legend className="visually-hidden">{student.name}</legend>
                    {MARKS.map((mark) => (
                      <label key={mark} className={`mark-${mark}`}>
                        <input
                          type="radio"
                          name={`status:${student.studentId}`}
                          value={mark}
                          defaultChecked={(student.status ?? 'present') === mark}
                        />
                        {ATTENDANCE_NAMES[mark]}
                      </label>
                    ))}
                  </fieldset>
                </li>
              ))}
            </ul>
            <button type="submit">Save the register</button>
          </form>
        ) : null}
      </section>

      <section aria-labelledby="grades" data-testid="grades">
        <h2 id="grades">Grades</h2>
        {view.students.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Child</th>
                <th>Grades</th>
                <th className="number">Average</th>
              </tr>
            </thead>
            <tbody>
              {view.students.map((student) => (
                <tr key={student.studentId}>
                  <td>{student.name}</td>
                  <td>
                    <span className="grades">
                      {student.grades.map((grade) => (
                        <span
                          key={grade.id}
                          className={`grade grade-${grade.value}`}
                          title={`${grade.subject}, term ${grade.term}, ${grade.givenOn}: ${GRADE_NAMES[grade.value]}`}
                        >
                          {grade.value}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="number">{student.average?.toFixed(2) ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {view.students.length > 0 ? (
          <form method="post" action={action} className="form-row" data-testid="add-grade">
            <input type="hidden" name="action" value="add-grade" />
            <label>
              Child
              <select name="student_id">
                {view.students.map((student) => (
                  <option key={student.studentId} value={student.studentId}>
                    {student.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Subject <input name="subject" required maxLength={80} list="subjects" placeholder="Maths" />
              <datalist id="subjects">
                {view.subjects.map((subject) => (
                  <option key={subject} value={subject} />
                ))}
              </datalist>
            </label>
            <label>
              Term
              <select name="term" defaultValue="1">
                <option value="1">First</option>
                <option value="2">Second</option>
              </select>
            </label>
            <label>
              Grade
              <select name="value" defaultValue="5">
                {Object.entries(GRADE_NAMES).map(([value, name]) => (
                  <option key={value} value={value}>
                    {`${value} · ${name}`}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Add the grade</button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
