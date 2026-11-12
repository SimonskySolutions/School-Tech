import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ATTENDANCE_NAMES, GRADE_NAMES } from '../../../../lib/academic';
import { fetchStudentProgress } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** A child's register and grades this school year, for the family. */
export default async function ChildProgressPage({ params }: { params: Params }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchStudentProgress(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Progress</h1>
        <p data-testid="not-permitted">This child is not linked to your account.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`${view.student.givenName}'s progress`}</h1>
      <p>{`School year ${view.academicYear}`}</p>

      <ul className="stats" data-testid="attendance-stats">
        {(Object.keys(view.attendance) as (keyof typeof view.attendance)[]).map((status) => (
          <li key={status}>
            <span className="stat-value">{view.attendance[status]}</span>
            <span className="stat-label">{`${ATTENDANCE_NAMES[status]} (days)`}</span>
          </li>
        ))}
      </ul>

      <section aria-labelledby="grades" data-testid="grades">
        <h2 id="grades">Grades</h2>
        {view.subjects.length === 0 ? <p>No grades yet this school year.</p> : null}
        {view.subjects.length > 0 ? (
          <table>
            <thead>
              <tr>
                <th>Subject</th>
                <th>Grades</th>
                <th className="number">Average</th>
              </tr>
            </thead>
            <tbody>
              {view.subjects.map((subject) => (
                <tr key={subject.subject}>
                  <td>{subject.subject}</td>
                  <td>
                    <span className="grades">
                      {subject.grades.map((grade) => (
                        <span
                          key={grade.id}
                          className={`grade grade-${grade.value}`}
                          title={`Term ${grade.term}, ${grade.givenOn}: ${GRADE_NAMES[grade.value]}`}
                        >
                          {grade.value}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="number">{subject.average?.toFixed(2) ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {view.missed.length > 0 ? (
        <section aria-labelledby="missed" data-testid="missed">
          <h2 id="missed">Days not marked present</h2>
          <ul>
            {view.missed.map((mark) => (
              <li key={mark.day}>{`${mark.day}: ${ATTENDANCE_NAMES[mark.status]}`}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
