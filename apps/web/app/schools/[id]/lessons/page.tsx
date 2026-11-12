import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolLessons } from '../../../../lib/api-client';
import { LESSON_NOTICES, WEEKDAY_NAMES } from '../../../../lib/lessons';
import { formatSessionTime, readRange, shiftRange } from '../../../../lib/school-life';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const grid = { display: 'grid', gap: '0.5rem', maxWidth: '32rem', margin: '0.5rem 0 1rem' } as const;

/** Teachers, rooms, their weekly hours and the lesson times of one school (ADR 0022). */
export default async function SchoolLessonsPage({
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
  const result = await fetchSchoolLessons(
    config.API_INTERNAL_URL,
    session.accessToken,
    id,
    readRange(query).from,
  );
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Lessons</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (LESSON_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const done_ = typeof query.created === 'string' ? `${query.created} lesson times created.` : done;
  const teachers = view.resources.filter((r) => r.kind === 'teacher' && r.active);
  const rooms = view.resources.filter((r) => r.kind === 'room' && r.active);
  const action = `/schools/${view.school.id}/lessons/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/school-life/registers">Registers</Link>
      </p>
      <h1>{`Lessons at ${view.school.name}`}</h1>
      {done_ ? (
        <p role="status" data-testid="done">
          {done_}
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-testid="error">
          {error}
        </p>
      ) : null}

      <section aria-labelledby="resources" data-testid="resources">
        <h2 id="resources">Teachers and rooms</h2>
        <p>
          Weekly hours are in the school&apos;s time. A lesson time needs both its teacher and its room free.
        </p>
        {view.resources.length === 0 ? <p>None yet.</p> : null}
        <ul>
          {view.resources.map((r) => (
            <li key={r.id} data-testid={`resource-${r.id}`}>
              <strong>{r.displayName}</strong>
              {` (${r.kind === 'teacher' ? 'teacher' : 'room'}${r.active ? '' : ', no longer in use'}): `}
              {r.hours.length === 0
                ? 'no hours yet'
                : r.hours.map((h) => `${WEEKDAY_NAMES[h.weekday - 1]} ${h.starts}–${h.ends}`).join('; ')}
              {view.canManage ? (
                <details>
                  <summary>Change the hours</summary>
                  <ul>
                    {r.hours.map((h) => (
                      <li key={h.id}>
                        <form method="post" action={action} style={{ display: 'inline' }}>
                          <input type="hidden" name="action" value="remove-hours" />
                          <input type="hidden" name="hours_id" value={h.id} />
                          {`${WEEKDAY_NAMES[h.weekday - 1]} ${h.starts}–${h.ends} `}
                          <button type="submit">Remove</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                  <form method="post" action={action} style={grid}>
                    <input type="hidden" name="action" value="add-hours" />
                    <input type="hidden" name="resource_id" value={r.id} />
                    <label>
                      Day{' '}
                      <select name="weekday" defaultValue="1">
                        {WEEKDAY_NAMES.map((name, index) => (
                          <option key={name} value={index + 1}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      From <input name="starts" required placeholder="14:00" size={5} />
                    </label>
                    <label>
                      To <input name="ends" required placeholder="17:00" size={5} />
                    </label>
                    <button type="submit">Add the hours</button>
                  </form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        {view.canManage ? (
          <form method="post" action={action} style={grid} data-testid="add-resource">
            <input type="hidden" name="action" value="add-resource" />
            <label>
              Kind{' '}
              <select name="kind" defaultValue="teacher">
                <option value="teacher">Teacher</option>
                <option value="room">Room</option>
              </select>
            </label>
            <label>
              Name parents see{' '}
              <input name="display_name" required maxLength={120} placeholder="Ms Petrova (piano)" />
            </label>
            <button type="submit">Add</button>
          </form>
        ) : null}
      </section>

      {view.canManage && view.offerings.length && teachers.length && rooms.length ? (
        <section aria-labelledby="create" data-testid="create-slots">
          <h2 id="create">Create lesson times</h2>
          <p>
            Fills the hours the teacher and the room share with back-to-back lessons. Times that would clash
            with another lesson of the teacher or the room are left out, so creating the same times again does
            nothing.
          </p>
          <form method="post" action={action} style={grid}>
            <input type="hidden" name="action" value="create-slots" />
            <label>
              Lessons{' '}
              <select name="offering_id">
                {view.offerings.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Teacher{' '}
              <select name="teacher_id">
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Room{' '}
              <select name="room_id">
                {rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              First day <input type="date" name="from" required />
            </label>
            <label>
              Last day <input type="date" name="to" required />
            </label>
            <label>
              Minutes per lesson <input name="minutes" inputMode="numeric" defaultValue="45" size={4} />
            </label>
            <button type="submit">Create the times</button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="times" data-testid="slots">
        <h2 id="times">Lesson times</h2>
        <p>
          <Link href={`/schools/${view.school.id}/lessons${shiftRange(view.from, view.days, -1)}`}>
            Earlier
          </Link>{' '}
          ·{' '}
          <Link href={`/schools/${view.school.id}/lessons${shiftRange(view.from, view.days, 1)}`}>Later</Link>
        </p>
        {view.slots.length === 0 ? <p>No lesson times in these days.</p> : null}
        <ul>
          {view.slots.map((slot) => (
            <li key={slot.sessionId} data-testid={`slot-${slot.sessionId}`}>
              {`${formatSessionTime(slot.startsAt, slot.endsAt, slot.timeZone)}, ${slot.offeringName}, ${[slot.teacher, slot.room].filter(Boolean).join(', ')}: ${
                slot.booked ? `booked${slot.bookedFor ? ` for ${slot.bookedFor}` : ''}` : 'free'
              }`}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
