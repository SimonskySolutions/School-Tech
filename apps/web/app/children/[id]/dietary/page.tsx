import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  ALLERGEN_CODES,
  ALLERGENS,
  DIETARY_KINDS,
  DIETARY_SEVERITIES,
  type DietaryNeed,
} from '@pythagoras/shared';
import { fetchStudentDietary } from '../../../../lib/api-client';
import { allergenNames, DIETARY_DONE } from '../../../../lib/dietary';
import { dietaryLabel, formatDay } from '../../../../lib/school-life';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KIND_TEXT: Record<string, string> = {
  allergy: 'Allergy',
  intolerance: 'Intolerance',
  medical_diet: 'Medical diet',
  religious_or_cultural: 'Religious or cultural',
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  other: 'Other',
};
const SEVERITY_TEXT: Record<string, string> = {
  information: 'For information',
  moderate: 'Moderate',
  severe: 'Severe',
  life_threatening: 'Life-threatening',
};

/** A parent records their child's dietary and health needs; School Life verifies them. */
export default async function ChildDietaryPage({
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
  const result = await fetchStudentDietary(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Dietary needs</h1>
        <p data-testid="not-permitted">This child is not linked to your account.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const child = result.value;
  const done = typeof query.done === 'string' ? (DIETARY_DONE[query.done] ?? null) : null;
  const error = typeof query.error === 'string' ? query.error : null;
  const name = `${child.student.givenName} ${child.student.familyName}`;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link> · <Link href="/services">Book lunch and clubs</Link>
      </p>
      <h1>{`Dietary needs: ${name}`}</h1>
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
      <p>
        The school kitchen and School Life see these needs on the lunch lists, and the lunch menu shows which
        dishes contain the allergens you tick. School Life checks every new need or change with you before
        marking it verified. In an emergency, always call the school.
      </p>

      <section aria-labelledby="current" data-testid="needs">
        <h2 id="current">Current needs</h2>
        {child.needs.length === 0 ? <p>None recorded.</p> : null}
        {child.needs.map((need) => (
          <article
            key={need.id}
            data-testid={`need-${need.id}`}
            style={{ borderTop: '1px solid #ccc', padding: '0.5rem 0' }}
          >
            <p>
              <strong>{dietaryLabel(need.kind, need.severity)}</strong>
              {`: ${need.description}`}
            </p>
            {need.allergens.length ? <p>{`Allergens: ${allergenNames(need.allergens)}`}</p> : null}
            <p data-testid="verification">
              {need.verified
                ? `Verified by School Life${need.verifiedAt ? ` on ${formatDay(need.verifiedAt.slice(0, 10))}` : ''}`
                : 'Not yet verified by School Life'}
              {need.validUntil ? `. Applies until ${formatDay(need.validUntil)}.` : ''}
            </p>
            {child.canChange && !need.validUntil ? (
              <details>
                <summary>Change</summary>
                <NeedForm action="change" studentId={child.student.id} need={need} />
              </details>
            ) : null}
            {child.canChange && !need.validUntil ? (
              <form
                method="post"
                action={`/children/${child.student.id}/dietary/actions`}
                style={{ display: 'inline' }}
              >
                <input type="hidden" name="action" value={need.canWithdraw ? 'withdraw' : 'end'} />
                <input type="hidden" name="need_id" value={need.id} />
                <button type="submit" data-testid={need.canWithdraw ? 'withdraw' : 'end'}>
                  {need.canWithdraw ? 'Remove (recorded by mistake)' : 'No longer needed from tomorrow'}
                </button>
              </form>
            ) : null}
          </article>
        ))}
      </section>

      {child.canChange ? (
        <section aria-labelledby="add">
          <h2 id="add">Add a need</h2>
          <NeedForm action="add" studentId={child.student.id} />
        </section>
      ) : (
        <p>Only a guardian who manages bookings for {child.student.givenName} can change these.</p>
      )}
    </main>
  );
}

function NeedForm({
  action,
  studentId,
  need,
}: {
  action: 'add' | 'change';
  studentId: string;
  need?: DietaryNeed;
}) {
  return (
    <form method="post" action={`/children/${studentId}/dietary/actions`} data-testid={`${action}-need-form`}>
      <input type="hidden" name="action" value={action} />
      {need ? <input type="hidden" name="need_id" value={need.id} /> : null}
      <p>
        <label>
          Kind{' '}
          <select name="kind" defaultValue={need?.kind ?? 'allergy'} required>
            {DIETARY_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {KIND_TEXT[kind]}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          How serious{' '}
          <select name="severity" defaultValue={need?.severity ?? ''}>
            <option value="">Not stated</option>
            {DIETARY_SEVERITIES.map((severity) => (
              <option key={severity} value={severity}>
                {SEVERITY_TEXT[severity]}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          Description{' '}
          <input
            name="description"
            defaultValue={need?.description ?? ''}
            maxLength={500}
            required
            size={60}
          />
        </label>
      </p>
      <fieldset>
        <legend>Allergens it involves</legend>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem' }}>
          {ALLERGEN_CODES.map((code) => (
            <label key={code}>
              <input
                type="checkbox"
                name="allergen"
                value={code}
                defaultChecked={need?.allergens.includes(code)}
              />{' '}
              {ALLERGENS[code]}
            </label>
          ))}
        </div>
      </fieldset>
      <button type="submit" data-testid={`${action}-need`}>
        {action === 'add' ? 'Save' : 'Save the change'}
      </button>
    </form>
  );
}
