import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { fetchStudents } from '../../../../lib/api-client';
import { academicYearOf, DONE, RELATIONSHIPS } from '../../../../lib/families';
import { currentSession, runtime } from '../../../../lib/server';
import { Notice } from '../../../admin/schools/notice';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const grid = { display: 'grid', gap: '0.5rem', maxWidth: '30rem' } as const;

/**
 * One school's students and their guardians (M3.3 API), for its staff.
 * Principals and school administrators enrol and record guardians; teachers see the list.
 */
export default async function StudentsPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!UUID.test(id)) notFound();
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchStudents(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind === 'not-found') notFound();
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Students</h1>
        <p data-testid="not-permitted">Your role at this school cannot see its students.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const list = result.value;
  const actions = `/schools/${list.school.id}/students/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Students at ${list.school.name}`}</h1>
      <Notice params={query} done={DONE} />
      {list.students.length === 0 ? <p>No students enrolled yet.</p> : null}
      {list.students.map((student) => (
        <section
          key={student.id}
          aria-labelledby={`student-${student.id}`}
          data-testid={`student-${student.givenName}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2 id={`student-${student.id}`}>
            {`${student.givenName} ${student.familyName}${student.classLabel ? `, ${student.classLabel}` : ''} (${student.academicYear})`}
          </h2>
          {student.guardians.length === 0 ? <p>No guardian recorded yet.</p> : null}
          <ul data-testid="guardians">
            {student.guardians.map((guardian) => (
              <li key={guardian.personId}>
                {`${guardian.name}, ${RELATIONSHIPS[guardian.relationship] ?? guardian.relationship}${guardian.status === 'pending' ? ' (not verified yet)' : ''}: ${
                  [
                    guardian.canPay ? 'pays' : null,
                    guardian.canManageBookings ? 'books' : null,
                    guardian.canConsent ? 'gives consent' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || 'sees the child only'
                }`}
              </li>
            ))}
          </ul>
          {list.canRecordGuardians ? (
            <details>
              <summary>Record a parent or guardian</summary>
              <form
                method="post"
                action={actions}
                style={grid}
                data-testid={`add-guardian-${student.givenName}`}
              >
                <input type="hidden" name="action" value="add-guardian" />
                <input type="hidden" name="student_id" value={student.id} />
                <p style={{ margin: 0 }}>
                  A parent who already has children in the group is found by their e-mail; names are needed
                  only for someone new.
                </p>
                <label>
                  E-mail <input type="email" name="email" required maxLength={254} />
                </label>
                <label>
                  First name <input name="given_name" maxLength={100} />
                </label>
                <label>
                  Family name <input name="family_name" maxLength={100} />
                </label>
                <label>
                  Relationship{' '}
                  <select name="relationship" defaultValue="parent">
                    {Object.entries(RELATIONSHIPS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <input type="checkbox" name="can_pay" defaultChecked /> Pays for the child
                </label>
                <label>
                  <input type="checkbox" name="can_manage_bookings" defaultChecked /> Books lunch and clubs
                </label>
                <label>
                  <input type="checkbox" name="can_consent" /> Gives consent (trips, photos)
                </label>
                <button type="submit">Record and verify</button>
              </form>
            </details>
          ) : null}
        </section>
      ))}

      {list.canEnrol ? (
        <section aria-labelledby="enrol">
          <h2 id="enrol">Enrol a student</h2>
          <form method="post" action={actions} style={grid} data-testid="enrol-student">
            <input type="hidden" name="action" value="enrol-student" />
            <label>
              First name <input name="given_name" required maxLength={100} />
            </label>
            <label>
              Family name <input name="family_name" required maxLength={100} />
            </label>
            <label>
              Date of birth (optional) <input type="date" name="date_of_birth" />
            </label>
            <label>
              School year{' '}
              <input
                name="academic_year"
                required
                pattern="\d{4}/\d{4}"
                defaultValue={academicYearOf(new Date())}
              />
            </label>
            <label>
              Grade <input name="grade_level" maxLength={40} />
            </label>
            <label>
              Class <input name="class_label" maxLength={40} />
            </label>
            <label>
              First day <input type="date" name="start_date" required />
            </label>
            <button type="submit">Enrol</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
