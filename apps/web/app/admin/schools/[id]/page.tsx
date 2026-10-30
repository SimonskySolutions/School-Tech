import { formatMoney } from '@pythagoras/shared';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DONE, PRICE_UNITS, ROLE_CHOICES, WEEKDAYS } from '../../../../lib/admin';
import { fetchSchoolSetup } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';
import { Notice } from '../notice';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const grid = { display: 'grid', gap: '0.5rem', maxWidth: '30rem' } as const;

/** Setting up one school: offerings and prices, calendars, staff, activation (M3.4). */
export default async function SchoolSetupPage({
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
  const result = await fetchSchoolSetup(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind === 'not-found') notFound();
  if (result.kind !== 'ok') redirect('/admin/schools');
  const { school, billingEntityName, serviceDefinitions, offerings, staff } = result.value;
  const back = `/admin/schools/${school.id}`;
  const bookable = serviceDefinitions.filter(
    (service) => service.kind === 'lunch' || service.kind === 'activity',
  );

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/admin/schools">Schools</Link>
      </p>
      <h1>{school.name}</h1>
      <p data-testid="school-summary">
        {`Status: ${school.status}. Code ${school.code}, time zone ${school.timeZone}, billed by ${billingEntityName}.`}
      </p>
      <Notice params={query} done={DONE} />

      {school.status === 'draft' ? (
        <section aria-labelledby="checklist" data-testid="checklist">
          <h2 id="checklist">Before it can go live</h2>
          {school.missing.length ? (
            <ul>
              {school.missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : (
            <p>Everything is in place.</p>
          )}
          <form method="post" action="/admin/actions">
            <input type="hidden" name="action" value="activate" />
            <input type="hidden" name="school_id" value={school.id} />
            <input type="hidden" name="back" value={back} />
            <button type="submit" disabled={school.missing.length > 0} data-testid="activate">
              Activate the school
            </button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="offerings">
        <h2 id="offerings">Offerings and prices</h2>
        {offerings.length === 0 ? <p>None yet.</p> : null}
        <ul data-testid="offerings">
          {offerings.map((offering) => (
            <li key={offering.id}>
              {`${offering.name}: ${
                offering.price
                  ? `${formatMoney(offering.price.unitAmountMinor, offering.price.currency)} ${PRICE_UNITS[offering.price.unit] ?? offering.price.unit}`
                  : 'no price'
              }; ${offering.sessions} sessions${offering.firstDate ? ` from ${offering.firstDate} to ${offering.lastDate}` : ''}`}
            </li>
          ))}
        </ul>
        <form method="post" action="/admin/actions" data-testid="add-offering" style={grid}>
          <input type="hidden" name="action" value="add-offering" />
          <input type="hidden" name="school_id" value={school.id} />
          <input type="hidden" name="back" value={back} />
          <label>
            Service{' '}
            <select name="service_definition_id" required>
              {bookable.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Name parents see{' '}
            <input name="name" required maxLength={200} placeholder={`Lunch at ${school.name}`} />
          </label>
          <label>
            Price in euros <input name="price" required inputMode="decimal" placeholder="5.20" />
          </label>
          <label>
            Charged{' '}
            <select name="price_unit" defaultValue="per_day">
              {Object.entries(PRICE_UNITS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Add the offering</button>
        </form>
      </section>

      {offerings.length > 0 ? (
        <section aria-labelledby="calendar">
          <h2 id="calendar">Calendar</h2>
          <p>
            Lunch runs on school days; booking closes at 10:00 the day before. Clubs meet weekly; booking
            closes 24 hours before. Adding the same days again changes nothing.
          </p>
          <form method="post" action="/admin/actions" data-testid="add-sessions" style={grid}>
            <input type="hidden" name="action" value="add-sessions" />
            <input type="hidden" name="school_id" value={school.id} />
            <input type="hidden" name="back" value={back} />
            <label>
              Offering{' '}
              <select name="offering_id" required>
                {offerings.map((offering) => (
                  <option key={offering.id} value={offering.id}>
                    {offering.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Pattern{' '}
              <select name="pattern" defaultValue="school_days">
                <option value="school_days">Every school day (lunch)</option>
                <option value="weekly">Once a week (clubs)</option>
              </select>
            </label>
            <label>
              From <input type="date" name="from" required />
            </label>
            <label>
              To <input type="date" name="to" required />
            </label>
            <label>
              Places per session{' '}
              <input type="number" name="capacity" min={1} max={5000} required defaultValue={80} />
            </label>
            <label>
              Closed days (one per line, YYYY-MM-DD) <textarea name="closed" rows={3} />
            </label>
            <fieldset>
              <legend>Weekly only</legend>
              <label>
                Day{' '}
                <select name="weekday" defaultValue="3">
                  {WEEKDAYS.map((day, index) => (
                    <option key={day} value={index + 1}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>{' '}
              <label>
                From <input type="time" name="start_time" defaultValue="14:00" />
              </label>{' '}
              <label>
                to <input type="time" name="end_time" defaultValue="15:00" />
              </label>{' '}
              <label>
                Room <input name="location" maxLength={100} />
              </label>
            </fieldset>
            <button type="submit">Add the calendar</button>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="staff">
        <h2 id="staff">Staff</h2>
        {staff.length === 0 ? <p>None yet.</p> : null}
        <ul data-testid="staff">
          {staff.map((member) => (
            <li key={`${member.personId}-${member.roleCode}`}>
              {member.hasAccount ? (
                `${member.name} (${member.roleName}${member.email ? `, ${member.email}` : ''}): can sign in`
              ) : (
                <>
                  {`${member.name} (${member.roleName}${member.email ? `, ${member.email}` : ''}): `}
                  <form method="post" action="/admin/actions" style={{ display: 'inline' }}>
                    <input type="hidden" name="action" value="create-account" />
                    <input type="hidden" name="person_id" value={member.personId} />
                    <input type="hidden" name="back" value={back} />
                    <button type="submit" data-testid={`create-account-${member.personId}`}>
                      Create sign-in account
                    </button>
                  </form>
                </>
              )}
            </li>
          ))}
        </ul>
        <form method="post" action="/admin/actions" data-testid="add-staff" style={grid}>
          <input type="hidden" name="action" value="add-staff" />
          <input type="hidden" name="school_id" value={school.id} />
          <input type="hidden" name="back" value={back} />
          <label>
            First name <input name="given_name" required maxLength={100} />
          </label>
          <label>
            Family name <input name="family_name" required maxLength={100} />
          </label>
          <label>
            E-mail <input type="email" name="email" required maxLength={254} />
          </label>
          <label>
            Role{' '}
            <select name="role_code" defaultValue="principal">
              {Object.entries(ROLE_CHOICES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Register the staff member</button>
        </form>
      </section>
    </main>
  );
}
