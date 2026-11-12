import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchStudentLessons } from '../../../../lib/api-client';
import { LESSON_NOTICES } from '../../../../lib/lessons';
import { formatSessionTime } from '../../../../lib/school-life';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** A family's lesson packages, the times they can book, and the lessons booked (ADR 0022). */
export default async function ChildLessonsPage({
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
  const result = await fetchStudentLessons(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Lessons</h1>
        <p data-testid="not-permitted">This child is not linked to your account.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const child = result.value;
  const done = typeof query.done === 'string' ? (LESSON_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const packageFor = (offeringId: string) =>
    child.packages.find((p) => p.offeringId === offeringId && p.lessonsLeft > 0);
  const action = `/children/${child.student.id}/lessons/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/services">Buy lessons, lunch and clubs</Link>
      </p>
      <h1>{`Lessons: ${child.student.givenName} ${child.student.familyName}`}</h1>
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

      <section aria-labelledby="packages" data-testid="packages">
        <h2 id="packages">Packages</h2>
        {child.packages.length === 0 ? (
          <p>
            No lessons bought yet. Lesson packages are on the <Link href="/services">booking page</Link>.
          </p>
        ) : (
          <ul>
            {child.packages.map((p) => (
              <li key={p.id} data-testid={`package-${p.id}`}>
                {`${p.offeringName}: ${p.lessonsLeft} of ${p.lessonsBought} lessons left`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {child.bookings.length ? (
        <section aria-labelledby="booked" data-testid="booked">
          <h2 id="booked">Booked lessons</h2>
          <ul>
            {child.bookings.map((b) => (
              <li key={b.bookingId} data-testid={`booking-${b.bookingId}`}>
                {`${b.offeringName}, ${formatSessionTime(b.startsAt, b.endsAt, b.timeZone)}, ${[b.teacher, b.room].filter(Boolean).join(', ')}`}
                {b.status !== 'confirmed' ? ` (${b.status === 'attended' ? 'attended' : 'absent'})` : ''}
                {b.canCancel ? (
                  <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                    <input type="hidden" name="action" value="cancel" />
                    <input type="hidden" name="booking_id" value={b.bookingId} />
                    <button type="submit" data-testid="cancel-lesson">
                      {b.cancelReturnsLesson
                        ? 'Cancel (the lesson goes back to the package)'
                        : 'Cancel (the lesson counts as used)'}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {child.slots.length ? (
        <section aria-labelledby="free" data-testid="free-slots">
          <h2 id="free">Free times, the next three weeks</h2>
          <ul>
            {child.slots.map((slot) => {
              const pkg = packageFor(slot.offeringId);
              return (
                <li key={slot.sessionId} data-testid={`slot-${slot.sessionId}`}>
                  {`${slot.offeringName}, ${formatSessionTime(slot.startsAt, slot.endsAt, slot.timeZone)}, ${[slot.teacher, slot.room].filter(Boolean).join(', ')}`}
                  {child.canBook && pkg ? (
                    <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                      <input type="hidden" name="action" value="book" />
                      <input type="hidden" name="session_id" value={slot.sessionId} />
                      <input type="hidden" name="package_id" value={pkg.id} />
                      <button type="submit" data-testid="book-lesson">
                        Book
                      </button>
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : child.packages.some((p) => p.lessonsLeft > 0) ? (
        <p>No free times in the next three weeks. Please ask School Life.</p>
      ) : null}
    </main>
  );
}
