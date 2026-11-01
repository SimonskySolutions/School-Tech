import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchSchoolConsents } from '../../../../lib/api-client';
import { STATE_LABELS } from '../../../../lib/consents';
import { currentSession, runtime } from '../../../../lib/server';
import { DevelopmentBanner } from '../../../development-banner';

export const dynamic = 'force-dynamic';

const cell = { border: '1px solid #ccc', padding: '0.25rem 0.5rem', textAlign: 'left' } as const;

/** Who may appear in photos and recordings, for the school's staff (M6.6, ADR 0030). */
export default async function SchoolConsentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchSchoolConsents(config.API_INTERNAL_URL, session.accessToken, id);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Photo and recording consents</h1>
        <p data-testid="not-permitted">This page is for the school&apos;s staff.</p>
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
      <h1>{`Photo and recording consents at ${view.school.name}`}</h1>
      <p>
        Only pupils marked &quot;Yes&quot; may appear, for that purpose only. &quot;Asked again&quot; means
        the wording changed and the family has not yet agreed to it: treat it as no. Families change this at
        any time, so look here before each use.
      </p>
      {view.pupils.length === 0 ? <p>No pupils are enrolled now.</p> : null}
      <table data-testid="consents" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={cell}>Pupil</th>
            <th style={cell}>Class</th>
            {view.purposes.map((purpose) => (
              <th key={purpose.purposeId} style={cell}>
                {purpose.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.pupils.map((pupil) => (
            <tr key={pupil.personId} data-testid={`pupil-${pupil.personId}`}>
              <td style={cell}>{pupil.name}</td>
              <td style={cell}>{pupil.classLabel ?? ''}</td>
              {view.purposes.map((purpose) => (
                <td key={purpose.purposeId} style={cell} data-testid={`${purpose.code}`}>
                  {STATE_LABELS[pupil.states[purpose.purposeId] ?? 'none']}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
