import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchStudentTimetable } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';
import { TimetableGrid } from '../../../timetable-grid';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;

/** A child's week, for the family. */
export default async function ChildTimetablePage({ params }: { params: Params }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchStudentTimetable(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Timetable</h1>
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
      <h1>{`${view.student.givenName}'s week`}</h1>
      <p>
        {view.classLabel
          ? `Class ${view.classLabel} · ${view.schoolName} · ${view.academicYear}`
          : 'Not in a class yet this school year.'}
      </p>
      {view.periods.length > 0 ? (
        <section aria-labelledby="week" data-testid="week">
          <h2 id="week">Timetable</h2>
          <TimetableGrid periods={view.periods} entries={view.entries} view="class" />
        </section>
      ) : null}
    </main>
  );
}
