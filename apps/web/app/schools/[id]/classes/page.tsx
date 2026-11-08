import Link from 'next/link';
import { redirect } from 'next/navigation';
import { type CSSProperties } from 'react';
import { fetchSchoolClasses } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { seats, TIMETABLE_NOTICES } from '../../../../lib/timetable';
import { DevelopmentBanner } from '../../../development-banner';
import { ResourceSelect } from './resource-select';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SEATS_BADGE = { ok: 'ok', warn: 'warn', full: 'full' } as const;

/** The classes of one school this year: how full each is, and who has no class yet. */
export default async function SchoolClassesPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const query = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchSchoolClasses(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Classes</h1>
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
  const taken = view.classes.reduce((sum, c) => sum + c.seatsTaken, 0);
  const places = view.classes.reduce((sum, c) => sum + c.capacity, 0);
  const full = view.classes.filter((c) => c.seatsTaken >= c.capacity).length;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href={`/schools/${view.school.id}/timetable`}>Timetable</Link>
      </p>
      <h1>{`Classes at ${view.school.name}`}</h1>
      <p>{`School year ${view.academicYear}`}</p>
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

      <ul className="stats" data-testid="class-stats">
        <li>
          <span className="stat-value">{view.classes.length}</span>
          <span className="stat-label">classes</span>
        </li>
        <li>
          <span className="stat-value">{`${taken}/${places}`}</span>
          <span className="stat-label">places taken</span>
        </li>
        <li>
          <span className="stat-value">{Math.max(places - taken, 0)}</span>
          <span className="stat-label">places free</span>
        </li>
        <li>
          <span className="stat-value">{full}</span>
          <span className="stat-label">full classes</span>
        </li>
      </ul>

      <section aria-labelledby="classes">
        <h2 id="classes">Classes</h2>
        {view.classes.length === 0 ? <p>No classes this year yet.</p> : null}
        <ul className="class-grid">
          {view.classes.map((c) => {
            const place = seats(c.seatsTaken, c.capacity);
            return (
              <li key={c.id} data-testid={`class-${c.label}`}>
                <div className="class-head">
                  <Link href={`/schools/${view.school.id}/classes/${c.id}`} className="class-name">
                    {c.label}
                  </Link>
                  <span className={`badge ${SEATS_BADGE[place.state]}`}>
                    {place.left === 0 ? 'Full' : `${place.left} free`}
                  </span>
                </div>
                <div
                  className={`meter ${place.state === 'ok' ? '' : place.state}`}
                  style={{ '--value': `${place.percent}%` } as CSSProperties}
                  role="img"
                  aria-label={`${c.seatsTaken} of ${c.capacity} places taken`}
                />
                <span className="seats">{`${c.seatsTaken} of ${c.capacity} places`}</span>
                <small>
                  {[c.formTeacher, c.homeRoom].filter(Boolean).join(' · ') || 'No form teacher yet'}
                </small>
              </li>
            );
          })}
        </ul>
      </section>

      {view.unplaced.length > 0 ? (
        <section aria-labelledby="unplaced" data-testid="unplaced">
          <h2 id="unplaced">Children without a class</h2>
          <p>Open a class to place them.</p>
          <ul>
            {view.unplaced.map((child) => (
              <li key={child.enrolmentId}>{child.name}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.canManage ? (
        <section aria-labelledby="add-class" data-testid="add-class">
          <h2 id="add-class">Add a class</h2>
          <form method="post" action={`/schools/${view.school.id}/classes/actions`} className="form-row">
            <input type="hidden" name="action" value="add-class" />
            <label>
              Name <input name="label" required maxLength={40} placeholder="3A" size={6} />
            </label>
            <label>
              Grade <input name="grade_level" required maxLength={40} placeholder="3" size={6} />
            </label>
            <label>
              Places <input name="capacity" required inputMode="numeric" defaultValue="24" size={4} />
            </label>
            <ResourceSelect name="form_teacher_id" label="Form teacher" choices={view.teachers} />
            <ResourceSelect name="home_room_id" label="Home room" choices={view.rooms} />
            <button type="submit">Add the class</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
