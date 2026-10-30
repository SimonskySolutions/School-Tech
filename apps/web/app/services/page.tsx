import Link from 'next/link';
import { type Allergen, formatMoney, type BookableOffering, type StudentOfferings } from '@pythagoras/shared';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { fetchMe, fetchOfferings, fetchStudentDietary } from '../../lib/api-client';
import { allergenNames, dishLine, menuWarnings } from '../../lib/dietary';
import { currentSession, runtime } from '../../lib/server';
import { activitySummary, CHECKOUT_ERRORS, formatServiceDate } from '../../lib/services';
import { DevelopmentBanner } from '../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Lunch days and clubs a parent can book for each child they may pay for. */
export default async function ServicesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const me = await fetchMe(config.API_INTERNAL_URL, session.accessToken);
  if (me.kind !== 'ok') redirect('/');

  const children = me.value.children.filter(
    (child) => child.capabilities.pay && child.capabilities.manageBookings,
  );
  const results = await Promise.all(
    children.map((child) => fetchOfferings(config.API_INTERNAL_URL, session.accessToken, child.id)),
  );
  const offerings = results.flatMap((result) => (result.kind === 'ok' ? [result.value] : []));
  // The child's declared allergens, so the menu can point out dishes that contain them.
  const dietary = await Promise.all(
    offerings.map((child) =>
      fetchStudentDietary(config.API_INTERNAL_URL, session.accessToken, child.student.id),
    ),
  );
  const allergensOf = new Map<string, Allergen[]>(
    dietary.flatMap((result) =>
      result.kind === 'ok'
        ? [
            [
              result.value.student.id,
              [...new Set(result.value.needs.flatMap((need) => need.allergens))],
            ] as const,
          ]
        : [],
    ),
  );
  const error = typeof params.error === 'string' ? (CHECKOUT_ERRORS[params.error] ?? null) : null;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Lunch and clubs</h1>
      {error ? (
        <p role="alert" data-testid="checkout-error">
          {error}
        </p>
      ) : null}
      {offerings.length === 0 ? (
        <p>There is nothing you can book at the moment.</p>
      ) : (
        <form method="post" action="/checkout" data-testid="booking-form">
          {/* One key per page view: a double submit returns the same checkout. */}
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          {offerings.map((child) => (
            <ChildOfferings
              key={child.student.id}
              child={child}
              allergens={allergensOf.get(child.student.id) ?? []}
            />
          ))}
          <p>
            Prices are confirmed on the next page before you pay. Places are held for 30 minutes while you
            pay.
          </p>
          <button type="submit" data-testid="continue-to-payment">
            Continue to payment
          </button>
        </form>
      )}
    </main>
  );
}

function ChildOfferings({ child, allergens }: { child: StudentOfferings; allergens: Allergen[] }) {
  return (
    <section aria-labelledby={`child-${child.student.id}`} data-testid={`child-${child.student.givenName}`}>
      <h2 id={`child-${child.student.id}`}>
        {child.student.givenName} {child.student.familyName}
      </h2>
      <p>
        <Link href={`/children/${child.student.id}/dietary`} data-testid="dietary-link">
          {allergens.length
            ? `Dietary needs (allergens: ${allergenNames(allergens).toLowerCase()})`
            : 'Dietary needs and allergies'}
        </Link>
      </p>
      {child.offerings.length === 0 ? <p>Nothing to book at this school yet.</p> : null}
      {child.offerings.map((offering) =>
        offering.pickSessions ? (
          <LunchDays
            key={offering.id}
            studentId={child.student.id}
            givenName={child.student.givenName}
            offering={offering}
            allergens={allergens}
          />
        ) : (
          <Activity key={offering.id} studentId={child.student.id} offering={offering} />
        ),
      )}
    </section>
  );
}

function priceText(offering: BookableOffering): string {
  const unit = offering.price.unit.replace('per_', 'per ');
  return `${formatMoney(offering.price.unitAmountMinor, offering.price.currency)} ${unit}`;
}

function LunchDays({
  studentId,
  givenName,
  offering,
  allergens,
}: {
  studentId: string;
  givenName: string;
  offering: BookableOffering;
  allergens: Allergen[];
}) {
  const days = offering.sessions.filter((session) => session.serviceDate);
  return (
    <fieldset data-testid={`offering-${offering.kind}`}>
      <legend>
        {offering.name}: {priceText(offering)}
      </legend>
      {days.length === 0 ? <p>No days open for booking.</p> : null}
      <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
        {days.map((day) => {
          const full = day.available === 0;
          const warnings = menuWarnings(day.menu, allergens);
          return (
            <li key={day.id} data-testid={`lunch-day-${day.serviceDate}`} style={{ marginBottom: '0.25rem' }}>
              <label style={{ opacity: day.alreadyBooked || full ? 0.6 : 1 }}>
                <input
                  type="checkbox"
                  name="lunch"
                  value={`${studentId}|${offering.id}|${day.id}`}
                  disabled={day.alreadyBooked || full}
                />{' '}
                {formatServiceDate(day.serviceDate!)}
                {day.alreadyBooked ? ' (booked)' : full ? ' (full)' : ''}
              </label>
              <div style={{ fontSize: '0.9em', marginLeft: '1.5rem' }} data-testid="day-menu">
                {day.menu.length ? day.menu.map(dishLine).join(' · ') : 'Menu not published yet'}
              </div>
              {warnings.length ? (
                <div
                  role="alert"
                  data-testid="allergen-warning"
                  style={{ marginLeft: '1.5rem', color: '#9b1c1c', fontWeight: 600 }}
                >
                  {`Contains ${allergenNames([...new Set(warnings.flatMap((w) => w.allergens))]).toLowerCase()}, declared for ${givenName}: ${warnings.map((w) => w.dish).join(', ')}. The kitchen is warned; please check with School Life before booking this day.`}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function Activity({ studentId, offering }: { studentId: string; offering: BookableOffering }) {
  const booked = offering.sessions.length > 0 && offering.sessions.every((session) => session.alreadyBooked);
  const full = offering.sessions.some((session) => !session.alreadyBooked && session.available === 0);
  const unavailable = booked || full || offering.sessions.length === 0;
  return (
    <fieldset data-testid={`offering-${offering.kind}`}>
      <legend>{offering.name}</legend>
      <label style={{ opacity: unavailable ? 0.6 : 1 }}>
        <input type="checkbox" name="activity" value={`${studentId}|${offering.id}`} disabled={unavailable} />{' '}
        {priceText(offering)} ({activitySummary(offering)})
        {booked
          ? ' (booked)'
          : full
            ? ' (full)'
            : offering.sessions.length === 0
              ? ' (no meetings open)'
              : ''}
      </label>
    </fieldset>
  );
}
