import { CONTRACT_KINDS, QUALIFICATION_KINDS } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolStaff } from '../../../../lib/api-client';
import { currentSession, runtime } from '../../../../lib/server';
import {
  ATTENTION_LABELS,
  CONTRACT_LABELS,
  QUALIFICATION_LABELS,
  ROLE_LABELS,
  STAFF_DONE,
  STATE_LABELS,
  workingTimeLabel,
} from '../../../../lib/staff';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const MISMATCH: Record<string, string> = {
  role_without_employment: 'Has a role here but no current employment',
  employment_without_role: 'Employed here but has no role in the platform',
};

/** A school's staff with their roles and employments (M6.1, ADR 0028). */
export default async function StaffPage({
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
  const result = await fetchSchoolStaff(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Staff</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s leaders.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const done = typeof query.done === 'string' ? (STAFF_DONE[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const action = `/schools/${view.school.id}/staff/actions`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>{`Staff at ${view.school.name}`}</h1>
      <p>Employment records only: payroll, salaries and personal identification numbers are not kept here.</p>
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
      {view.people.some((person) => person.attention.length > 0) ? (
        <section aria-labelledby="needs-attention" data-testid="needs-attention">
          <h2 id="needs-attention">Needs attention</h2>
          <ul>
            {view.people
              .filter((person) => person.attention.length > 0)
              .map((person) => (
                <li key={person.personId}>
                  {`${person.name}: ${person.attention.map((item) => ATTENTION_LABELS[item].toLowerCase()).join('; ')}`}
                </li>
              ))}
          </ul>
        </section>
      ) : null}
      {view.people.length === 0 ? <p>No staff yet.</p> : null}
      {view.people.map((person) => (
        <article
          key={person.personId}
          data-testid={`staff-${person.personId}`}
          style={{ border: '1px solid #ccc', borderRadius: 4, padding: '0 1rem 1rem', marginBottom: '1rem' }}
        >
          <h2>{person.name}</h2>
          <p>
            {[
              person.roles.length
                ? person.roles.map((role) => ROLE_LABELS[role] ?? role).join(', ')
                : 'No role here',
              person.email,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {person.mismatch ? (
            <p role="alert" data-testid="mismatch" style={{ color: '#9b1c1c' }}>
              {MISMATCH[person.mismatch]}
            </p>
          ) : null}
          <ul>
            {person.employments.map((employment) => (
              <li key={employment.id} data-testid={`employment-${employment.id}`}>
                {`${employment.position}, ${CONTRACT_LABELS[employment.contractKind].toLowerCase()}, ${workingTimeLabel(employment.workingTime)}, with ${employment.employer.name}, from ${employment.startDate}${employment.endDate ? ` to ${employment.endDate}` : ''}${employment.current ? '' : ' (not current)'}`}
                {employment.workEmail || employment.workPhone ? (
                  <div>{[employment.workEmail, employment.workPhone].filter(Boolean).join(' · ')}</div>
                ) : null}
                {view.canManage && employment.current ? (
                  <form method="post" action={action} style={{ marginTop: '0.25rem' }}>
                    <input type="hidden" name="action" value="end" />
                    <input type="hidden" name="employment_id" value={employment.id} />
                    <label>
                      Ends on <input type="date" name="end_date" required />
                    </label>{' '}
                    <button type="submit" data-testid="end-employment">
                      Set the end
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {person.attention.length > 0 ? (
            <ul data-testid="attention" style={{ color: '#9b1c1c' }}>
              {person.attention.map((item) => (
                <li key={item}>{ATTENTION_LABELS[item]}</li>
              ))}
            </ul>
          ) : null}
          <p data-testid="record-check">
            {person.recordCheck
              ? `Criminal record check: certificate seen ${person.recordCheck.seenOn}${person.recordCheck.seenBy ? ` by ${person.recordCheck.seenBy}` : ''}, valid until ${person.recordCheck.validUntil} (${STATE_LABELS[person.recordCheck.state]})`
              : 'Criminal record check: none recorded'}
          </p>
          {person.qualifications.length > 0 ? (
            <ul data-testid="qualifications">
              {person.qualifications.map((qualification) => (
                <li key={qualification.id} data-testid={`qualification-${qualification.id}`}>
                  {`${QUALIFICATION_LABELS[qualification.kind]}: ${qualification.title}${qualification.issuer ? `, ${qualification.issuer}` : ''}, from ${qualification.awardedOn}${qualification.expiresOn ? ` until ${qualification.expiresOn} (${STATE_LABELS[qualification.state]})` : ''}`}
                  {view.canManage ? (
                    <form method="post" action={action} style={{ display: 'inline', marginLeft: '0.5rem' }}>
                      <input type="hidden" name="action" value="withdraw" />
                      <input type="hidden" name="qualification_id" value={qualification.id} />
                      <button type="submit" data-testid="withdraw-qualification">
                        Recorded in error
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {view.canManage ? (
            <details style={{ marginTop: '0.5rem' }}>
              <summary>Add a qualification or a record check</summary>
              <form
                method="post"
                action={action}
                style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem' }}
              >
                <input type="hidden" name="action" value="qualify" />
                <input type="hidden" name="person_id" value={person.personId} />
                <label>
                  Kind{' '}
                  <select name="kind" defaultValue="first_aid">
                    {QUALIFICATION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {QUALIFICATION_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Title <input name="title" required maxLength={200} />
                </label>
                <label>
                  Issued by (optional) <input name="issuer" maxLength={200} />
                </label>
                <label>
                  Awarded on <input name="awarded_on" type="date" required />
                </label>
                <label>
                  Expires on (if it does) <input name="expires_on" type="date" />
                </label>
                <button type="submit" data-testid="add-qualification">
                  Add the qualification
                </button>
              </form>
              <form
                method="post"
                action={action}
                style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem', marginTop: '0.5rem' }}
              >
                <input type="hidden" name="action" value="check" />
                <input type="hidden" name="person_id" value={person.personId} />
                <p style={{ margin: 0 }}>
                  A criminal record certificate allowing the work was seen. Record only the dates: never keep
                  the certificate or what it says.
                </p>
                <label>
                  Seen on <input name="seen_on" type="date" required />
                </label>
                <label>
                  Valid until <input name="valid_until" type="date" required />
                </label>
                <button type="submit" data-testid="add-check">
                  Note the check
                </button>
              </form>
            </details>
          ) : null}
        </article>
      ))}

      {view.canManage && view.people.length > 0 ? (
        <section aria-labelledby="record" data-testid="record-employment">
          <h2 id="record">Record an employment</h2>
          <form method="post" action={action} style={{ display: 'grid', gap: '0.5rem', maxWidth: '36rem' }}>
            <input type="hidden" name="action" value="record" />
            <label>
              Member of staff{' '}
              <select name="person_id" required defaultValue="">
                <option value="" disabled>
                  Choose
                </option>
                {view.people.map((person) => (
                  <option key={person.personId} value={person.personId}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Employer{' '}
              <select name="employer_id" required defaultValue={view.employers[0]?.id ?? ''}>
                {view.employers.map((employer) => (
                  <option key={employer.id} value={employer.id}>
                    {employer.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Position <input name="position" required maxLength={100} />
            </label>
            <label>
              Contract{' '}
              <select name="contract_kind" defaultValue="permanent">
                {CONTRACT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {CONTRACT_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Working time (% of full time){' '}
              <input name="working_time" type="number" min={1} max={100} defaultValue={100} required />
            </label>
            <label>
              From <input name="start_date" type="date" required />
            </label>
            <label>
              Until (required for a fixed term) <input name="end_date" type="date" />
            </label>
            <label>
              Work e-mail (optional) <input name="work_email" type="email" maxLength={254} />
            </label>
            <label>
              Work telephone (optional) <input name="work_phone" type="tel" placeholder="+359888123456" />
            </label>
            <button type="submit" data-testid="record">
              Record the employment
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
