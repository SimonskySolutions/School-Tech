import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchMyEmployments } from '../../../lib/api-client';
import { currentSession, runtime } from '../../../lib/server';
import { CONTRACT_LABELS, QUALIFICATION_LABELS, STATE_LABELS, workingTimeLabel } from '../../../lib/staff';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

/** A member of staff's own employment records, qualifications and check (M6.1, M6.2, ADR 0028). */
export default async function MyEmploymentPage() {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');
  const { config } = runtime();
  const result = await fetchMyEmployments(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  const records =
    result.kind === 'ok' ? result.value : { employments: [], qualifications: [], recordCheck: null };
  const employments = records.employments;
  return (
    <main>
      <DevelopmentBanner />
      <p>
        <Link href="/">Home</Link>
      </p>
      <h1>My employment</h1>
      {employments.length === 0 ? <p data-testid="none">No employment is recorded for you.</p> : null}
      <ul data-testid="my-employments">
        {employments.map((employment) => (
          <li key={employment.id}>
            {`${employment.position} at ${employment.school?.name ?? 'the group'}, ${CONTRACT_LABELS[employment.contractKind].toLowerCase()}, ${workingTimeLabel(employment.workingTime)}, with ${employment.employer.name}, from ${employment.startDate}${employment.endDate ? ` to ${employment.endDate}` : ''}`}
          </li>
        ))}
      </ul>
      <h2>Qualifications</h2>
      {records.qualifications.length === 0 ? <p>None recorded.</p> : null}
      <ul data-testid="my-qualifications">
        {records.qualifications.map((qualification) => (
          <li key={qualification.id}>
            {`${QUALIFICATION_LABELS[qualification.kind]}: ${qualification.title}, from ${qualification.awardedOn}${qualification.expiresOn ? ` until ${qualification.expiresOn} (${STATE_LABELS[qualification.state]})` : ''}`}
          </li>
        ))}
      </ul>
      <h2>Criminal record check</h2>
      <p data-testid="my-check">
        {records.recordCheck
          ? `Certificate seen ${records.recordCheck.seenOn}, valid until ${records.recordCheck.validUntil} (${STATE_LABELS[records.recordCheck.state]}).`
          : 'None recorded.'}
      </p>
      <p>If something here is wrong, ask your school&apos;s office to correct it.</p>
    </main>
  );
}
