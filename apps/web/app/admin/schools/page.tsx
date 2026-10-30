import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchOnboarding } from '../../../lib/api-client';
import { DONE } from '../../../lib/admin';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';
import { Notice } from './notice';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const KINDS = ['school', 'kindergarten', 'sports_academy', 'training_centre', 'college', 'other'];

/** Group administrators: the group's companies and schools, and adding new ones (M3.4). */
export default async function SchoolsAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchOnboarding(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Schools</h1>
        <p data-testid="not-permitted">Setting up schools is for group administrators.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const { billingEntities, schools } = result.value;

  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>Schools</h1>
      <Notice params={params} done={DONE} />

      <table style={{ borderCollapse: 'collapse', marginBottom: '1.5rem' }} data-testid="schools">
        <thead>
          <tr>
            <th style={{ textAlign: 'left', paddingRight: '1rem' }}>School</th>
            <th style={{ textAlign: 'left', paddingRight: '1rem' }}>Status</th>
            <th style={{ textAlign: 'left' }}>Still needed before it can go live</th>
          </tr>
        </thead>
        <tbody>
          {schools.map((school) => (
            <tr key={school.id} data-testid={`school-${school.code}`} style={{ verticalAlign: 'top' }}>
              <td style={{ paddingRight: '1rem' }}>
                <Link href={`/admin/schools/${school.id}`}>{school.name}</Link>
              </td>
              <td style={{ paddingRight: '1rem' }} data-testid="status">
                {school.status}
              </td>
              <td>{school.status === 'draft' ? school.missing.join('; ') || 'Ready to activate' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section aria-labelledby="new-school">
        <h2 id="new-school">Add a school</h2>
        <form
          method="post"
          action="/admin/actions"
          data-testid="create-school"
          style={{ display: 'grid', gap: '0.5rem', maxWidth: '28rem' }}
        >
          <input type="hidden" name="action" value="create-school" />
          <input type="hidden" name="back" value="/admin/schools" />
          <label>
            Name <input name="name" required maxLength={200} />
          </label>
          <label>
            Code (lower-case, used in its web address){' '}
            <input name="code" required pattern="[a-z0-9][a-z0-9-]{1,62}" />
          </label>
          <label>
            Kind{' '}
            <select name="kind" defaultValue="school">
              {KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Time zone <input name="time_zone" defaultValue="Europe/Sofia" required />
          </label>
          <label>
            Billed by{' '}
            <select name="billing_entity_id" required>
              {billingEntities
                .filter((entity) => entity.status === 'active')
                .map((entity) => (
                  <option key={entity.id} value={entity.id}>
                    {entity.legalName}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit">Create the school as a draft</button>
        </form>
      </section>

      <section aria-labelledby="new-company">
        <h2 id="new-company">Add a billing company</h2>
        <p>{`Companies: ${billingEntities.map((entity) => entity.legalName).join(', ')}`}</p>
        <form
          method="post"
          action="/admin/actions"
          data-testid="create-company"
          style={{ display: 'grid', gap: '0.5rem', maxWidth: '28rem' }}
        >
          <input type="hidden" name="action" value="create-company" />
          <input type="hidden" name="back" value="/admin/schools" />
          <label>
            Legal name <input name="legal_name" required maxLength={200} />
          </label>
          <label>
            Registration number (EIK) <input name="registration_number" required maxLength={40} />
          </label>
          <label>
            VAT number (optional) <input name="vat_number" maxLength={40} />
          </label>
          <button type="submit">Add the company</button>
        </form>
      </section>
    </main>
  );
}
