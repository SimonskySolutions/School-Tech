import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatMoney } from '@pythagoras/shared';
import { fetchStudentTrips } from '../../../../lib/api-client';
import { formatSessionTime } from '../../../../lib/school-life';
import { currentSession, runtime } from '../../../../lib/server';
import { TRIP_NOTICES } from '../../../../lib/trips';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const CHANNELS: Record<string, string> = {
  family_portal: 'here',
  paper: 'on paper',
  in_person: 'in person',
};

/** A guardian reads each trip's wording and gives or withdraws permission (ADR 0023). */
export default async function ChildTripsPage({
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
  const result = await fetchStudentTrips(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Trips</h1>
        <p data-testid="not-permitted">This child is not linked to your account.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const child = result.value;
  const done = typeof query.done === 'string' ? (TRIP_NOTICES[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const action = `/children/${child.student.id}/trips/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/services">Book lunch, clubs and trips</Link>
      </p>
      <h1>{`Trips: ${child.student.givenName} ${child.student.familyName}`}</h1>
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
      {child.trips.length === 0 ? (
        <p>No trips coming up at {child.student.givenName}&apos;s school.</p>
      ) : null}
      {child.trips.map((trip) => (
        <section
          key={trip.sessionId}
          aria-labelledby={`trip-${trip.sessionId}`}
          data-testid={`trip-${trip.sessionId}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2 id={`trip-${trip.sessionId}`}>{trip.name}</h2>
          <p>
            {[
              formatSessionTime(trip.startsAt, trip.endsAt, trip.timeZone),
              trip.location,
              trip.price ? formatMoney(trip.price.unitAmountMinor, trip.price.currency) : null,
              trip.available === null ? null : `${trip.available} places left`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {trip.consent ? (
            <blockquote
              data-testid="wording"
              style={{ borderLeft: '3px solid #ccc', margin: '0.5rem 0', paddingLeft: '0.75rem' }}
            >
              {trip.consent.wording}
            </blockquote>
          ) : (
            <p>The school has not written the permission wording yet.</p>
          )}

          {trip.permission ? (
            <>
              <p data-testid="permission">
                {`Permission given ${CHANNELS[trip.permission.channel] ?? ''}${trip.permission.givenByMe ? ' by you' : ' by another guardian'}. Emergency contact: ${trip.permission.emergencyContactName}, ${trip.permission.emergencyContactPhone}.`}
                {trip.permission.forCurrentWording
                  ? ''
                  : ' The school has changed the wording since; please give permission again before booking.'}
              </p>
              {trip.booking ? (
                <p data-testid="booking">
                  {trip.booking === 'reserved' ? 'Booked, payment open.' : 'Booked.'}
                </p>
              ) : (
                <p>
                  Now book the place on the <Link href="/services">booking page</Link>.
                </p>
              )}
              {child.canConsent ? (
                <form method="post" action={action}>
                  <input type="hidden" name="action" value="withdraw" />
                  <input type="hidden" name="permission_id" value={trip.permission.id} />
                  <button type="submit" data-testid="withdraw">
                    {trip.booking === 'confirmed'
                      ? 'Withdraw permission (cancels the place; what you paid becomes credit)'
                      : 'Withdraw permission'}
                  </button>
                </form>
              ) : null}
            </>
          ) : trip.consent && child.canConsent ? (
            <form
              method="post"
              action={action}
              data-testid="give-permission"
              style={{ display: 'grid', gap: '0.5rem', maxWidth: '32rem' }}
            >
              <input type="hidden" name="action" value="give" />
              <input type="hidden" name="session_id" value={trip.sessionId} />
              <input type="hidden" name="policy_version_id" value={trip.consent.policyVersionId} />
              <label>
                Emergency contact on the day <input name="contact_name" required maxLength={120} />
              </label>
              <label>
                Their phone number <input name="contact_phone" required placeholder="+359 88 123 4567" />
              </label>
              <label>
                <input type="checkbox" name="agree" value="yes" required /> I have read the wording above and
                give permission.
              </label>
              <button type="submit" data-testid="give">
                Give permission
              </button>
            </form>
          ) : trip.consent ? (
            <p data-testid="cannot-consent">
              Another guardian of {child.student.givenName} needs to give permission.
            </p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
