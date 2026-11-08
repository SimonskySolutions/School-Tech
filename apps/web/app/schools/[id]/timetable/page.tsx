import { type NamedChoice, type TimetableView } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolTimetable } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { readView, SCHOOL_DAYS, TIMETABLE_NOTICES } from '../../../../lib/timetable';
import { DevelopmentBanner } from '../../../development-banner';
import { TimetableGrid } from '../../../timetable-grid';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const VIEW_NAMES: Record<TimetableView, string> = {
  class: 'By class',
  teacher: 'By teacher',
  room: 'By room',
};

function Choice({
  name,
  label,
  choices,
  chosen,
}: {
  name: string;
  label: string;
  choices: readonly NamedChoice[];
  chosen?: string | null;
}) {
  return (
    <label>
      {label}
      <select name={name} defaultValue={chosen ?? undefined}>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The week of a school by class, teacher or room, and for planners the way to change it. */
export default async function SchoolTimetablePage({
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
  const wanted = readView(query.view);
  const of = typeof query.of === 'string' ? query.of : null;
  const result = await fetchSchoolTimetable(config.API_INTERNAL_URL, session.accessToken, id, wanted, of);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Timetable</h1>
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
  const path = `/schools/${view.school.id}/timetable`;
  const action = `${path}/actions`;
  const selected = view.choices.find((choice) => choice.id === view.selectedId);
  const canPlan = view.canManage && view.periods.length > 0 && view.classes.length > 0;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href={`/schools/${view.school.id}/classes`}>Classes</Link>
      </p>
      <h1>{`Timetable at ${view.school.name}`}</h1>
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

      <nav className="view-switch" aria-label="Show the timetable">
        {(Object.keys(VIEW_NAMES) as TimetableView[]).map((name) => (
          <Link
            key={name}
            href={`${path}?view=${name}`}
            aria-current={name === view.view ? 'page' : undefined}
          >
            {VIEW_NAMES[name]}
          </Link>
        ))}
      </nav>
      <nav className="view-switch" aria-label={VIEW_NAMES[view.view]}>
        {view.choices.map((choice) => (
          <Link
            key={choice.id}
            href={`${path}?view=${view.view}&of=${choice.id}`}
            aria-current={choice.id === view.selectedId ? 'page' : undefined}
          >
            {choice.name}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="week" data-testid="week">
        <h2 id="week">{selected ? `The week of ${selected.name}` : 'The week'}</h2>
        {view.periods.length === 0 ? <p>Add the school&apos;s lesson periods first.</p> : null}
        {view.periods.length > 0 && view.choices.length === 0 ? <p>Nothing to show yet.</p> : null}
        {view.periods.length > 0 && view.choices.length > 0 ? (
          <TimetableGrid
            periods={view.periods}
            entries={view.entries}
            view={view.view}
            {...(view.canManage ? { removeAction: action } : {})}
          />
        ) : null}
      </section>

      {canPlan ? (
        <section aria-labelledby="add-lesson" data-testid="add-lesson">
          <h2 id="add-lesson">Add a lesson</h2>
          <p>A class, a teacher and a room can each be in only one place in a period.</p>
          <form method="post" action={action} className="form-row">
            <input type="hidden" name="action" value="add-lesson" />
            <Choice
              name="class_id"
              label="Class"
              choices={view.classes}
              chosen={view.view === 'class' ? view.selectedId : null}
            />
            <label>
              Day
              <select name="weekday" defaultValue="1">
                {SCHOOL_DAYS.map((day, index) => (
                  <option key={day} value={index + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <Choice
              name="period_id"
              label="Period"
              choices={view.periods.map((p) => ({ id: p.id, name: `${p.position} (${p.starts})` }))}
            />
            <label>
              Subject <input name="subject" required maxLength={80} placeholder="Maths" />
            </label>
            <Choice
              name="teacher_id"
              label="Teacher"
              choices={view.teachers}
              chosen={view.view === 'teacher' ? view.selectedId : null}
            />
            <Choice
              name="room_id"
              label="Room"
              choices={view.rooms}
              chosen={view.view === 'room' ? view.selectedId : null}
            />
            <button type="submit">Add the lesson</button>
          </form>
        </section>
      ) : null}

      {view.canManage ? (
        <section aria-labelledby="periods" data-testid="periods">
          <h2 id="periods">Lesson periods</h2>
          {view.periods.length === 0 ? <p>None yet.</p> : null}
          <ul>
            {view.periods.map((period) => (
              <li key={period.id}>{`${period.position}: ${period.starts}–${period.ends}`}</li>
            ))}
          </ul>
          <form method="post" action={action} className="form-row">
            <input type="hidden" name="action" value="add-period" />
            <label>
              Number{' '}
              <input
                name="position"
                required
                inputMode="numeric"
                defaultValue={view.periods.length + 1}
                size={3}
              />
            </label>
            <label>
              From <input name="starts" required placeholder="08:30" size={5} />
            </label>
            <label>
              To <input name="ends" required placeholder="09:10" size={5} />
            </label>
            <button type="submit">Add the period</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
