import Link from 'next/link';
import { redirect } from 'next/navigation';
import { type CSSProperties } from 'react';
import { fetchClassDetail } from '../../../../../lib/api-client';
import { currentSession, runtime } from '../../../../../lib/server';
import { seats, TIMETABLE_NOTICES } from '../../../../../lib/timetable';
import { DevelopmentBanner } from '../../../../development-banner';
import { ResourceSelect } from '../resource-select';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string; classId: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** One class: who sits in it, and its limit, teacher and room. */
export default async function ClassPage({
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
  const result = await fetchClassDetail(config.API_INTERNAL_URL, session.accessToken, id, classId);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Class</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (TIMETABLE_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const place = seats(view.class.seatsTaken, view.class.capacity);
  const schoolPath = `/schools/${view.school.id}`;
  const action = `${schoolPath}/classes/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href={`${schoolPath}/classes`}>Classes</Link> ·{' '}
        <Link href={`${schoolPath}/timetable?of=${view.class.id}`}>Timetable</Link>
        {view.canTeach ? (
          <>
            {' · '}
            <Link href={`${schoolPath}/classes/${view.class.id}/register`} data-testid="register-link">
              Register and grades
            </Link>
          </>
        ) : null}
      </p>
      <h1>{`Class ${view.class.label}`}</h1>
      <p>{`${view.school.name} · Grade ${view.class.gradeLevel}`}</p>
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

      <section aria-labelledby="roster" data-testid="roster">
        <div className="class-head">
          <h2 id="roster">{`Children (${view.class.seatsTaken} of ${view.class.capacity})`}</h2>
          <span className={`badge ${place.state}`}>{place.left === 0 ? 'Full' : `${place.left} free`}</span>
        </div>
        <div
          className={`meter ${place.state === 'ok' ? '' : place.state}`}
          style={{ '--value': `${place.percent}%` } as CSSProperties}
          role="img"
          aria-label={`${view.class.seatsTaken} of ${view.class.capacity} places taken`}
        />
        {view.students.length === 0 ? <p>No children in this class yet.</p> : null}
        <ul>
          {view.students.map((student) => (
            <li key={student.enrolmentId} data-testid={`student-${student.studentId}`}>
              {student.name}
            </li>
          ))}
        </ul>
        {view.canManage && view.unplaced.length > 0 ? (
          <form method="post" action={action} className="form-row" data-testid="place-student">
            <input type="hidden" name="action" value="place-student" />
            <input type="hidden" name="class_id" value={view.class.id} />
            <label>
              Child
              <select name="enrolment_id">
                {view.unplaced.map((child) => (
                  <option key={child.enrolmentId} value={child.enrolmentId}>
                    {child.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Place in this class</button>
          </form>
        ) : null}
      </section>

      {view.canManage ? (
        <section aria-labelledby="change-class" data-testid="change-class">
          <h2 id="change-class">Limit, teacher and room</h2>
          <form method="post" action={action} className="form-row">
            <input type="hidden" name="action" value="change-class" />
            <input type="hidden" name="class_id" value={view.class.id} />
            <label>
              Places{' '}
              <input
                name="capacity"
                required
                inputMode="numeric"
                defaultValue={view.class.capacity}
                size={4}
              />
            </label>
            <ResourceSelect
              name="form_teacher_id"
              label="Form teacher"
              choices={view.teachers}
              chosen={view.class.formTeacherId}
            />
            <ResourceSelect
              name="home_room_id"
              label="Home room"
              choices={view.rooms}
              chosen={view.class.homeRoomId}
            />
            <button type="submit">Save</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
