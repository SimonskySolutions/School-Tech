import Link from 'next/link';
import { redirect } from 'next/navigation';
import { fetchAdmissionsPipeline } from '../../../lib/api-client';
import { FOLLOW_UP_LABELS, notPlaced } from '../../../lib/admissions';
import { currentSession, runtime } from '../../../lib/server';
import { DevelopmentBanner } from '../../development-banner';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cell = { padding: '0.25rem 0.75rem 0.25rem 0', textAlign: 'right' } as const;
const first = { ...cell, textAlign: 'left' } as const;

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/Sofia' }).format(
    new Date(iso),
  );

/**
 * Admissions in numbers (M5.5): applications per intake and inquiries per
 * website, for the school's admissions staff and the CEO; no names. Staff also
 * see what needs following up.
 */
export default async function PipelinePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const since = typeof params.since === 'string' && DAY.test(params.since) ? params.since : null;
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchAdmissionsPipeline(config.API_INTERNAL_URL, session.accessToken, since);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>Admissions in numbers</h1>
        <p data-testid="not-permitted">This page is for admissions staff and the CEO.</p>
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
      <h1>Admissions in numbers</h1>

      {view.followUps ? (
        <section aria-labelledby="follow-ups" data-testid="follow-ups">
          <h2 id="follow-ups">To follow up</h2>
          {view.followUps.length === 0 ? <p>Nothing is waiting.</p> : null}
          <ul>
            {view.followUps.map((item, index) => (
              <li key={index} data-testid={`follow-up-${item.kind}`}>
                <Link href={item.href}>
                  {`${FOLLOW_UP_LABELS[item.kind]}: ${item.label ?? 'erased'}, ${item.school.name}, ${item.kind === 'offer_ending' ? 'ends' : 'since'} ${when(item.at)}`}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="intakes" data-testid="pipeline-intakes">
        <h2 id="intakes">Applications per intake</h2>
        {view.intakes.length === 0 ? <p>No intakes yet.</p> : null}
        {view.intakes.length > 0 ? (
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={first}>Intake</th>
                <th style={cell}>Places</th>
                <th style={cell}>Free</th>
                <th style={cell}>New and in review</th>
                <th style={cell}>Waiting list</th>
                <th style={cell}>Offered</th>
                <th style={cell}>Accepted</th>
                <th style={cell}>Enrolled</th>
                <th style={cell}>Not placed</th>
                <th style={cell}>From an inquiry</th>
              </tr>
            </thead>
            <tbody>
              {view.intakes.map((intake) => (
                <tr key={intake.id} data-testid={`pipeline-intake-${intake.id}`}>
                  <td style={first}>
                    {`${intake.school.name}, grade ${intake.grade}, ${intake.schoolYear}${intake.status === 'closed' ? ' (closed)' : ''}`}
                  </td>
                  <td style={cell}>{intake.places}</td>
                  <td style={cell}>{intake.free}</td>
                  <td style={cell}>{intake.counts.submitted + intake.counts.under_review}</td>
                  <td style={cell}>{intake.counts.waitlisted}</td>
                  <td style={cell}>{intake.counts.offered}</td>
                  <td style={cell}>{intake.counts.accepted}</td>
                  <td style={cell}>{intake.counts.enrolled}</td>
                  <td style={cell}>{notPlaced(intake.counts)}</td>
                  <td style={cell}>{intake.fromInquiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section aria-labelledby="inquiries" data-testid="pipeline-inquiries">
        <h2 id="inquiries">{`Inquiries per website${view.since ? ` since ${view.since}` : ''}`}</h2>
        <form method="get" action="/admissions/pipeline">
          <label>
            Since <input type="date" name="since" defaultValue={view.since ?? ''} />
          </label>{' '}
          <button type="submit">Show</button>
        </form>
        {view.inquiries.length === 0 ? <p>No inquiries.</p> : null}
        {view.inquiries.length > 0 ? (
          <table style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={first}>School and website</th>
                <th style={cell}>Received</th>
                <th style={cell}>Waiting</th>
                <th style={cell}>Contacted</th>
                <th style={cell}>Closed</th>
                <th style={cell}>Applied</th>
                <th style={cell}>Invited to apply</th>
              </tr>
            </thead>
            <tbody>
              {view.inquiries.map((row) => (
                <tr
                  key={`${row.school.id}-${row.website.id}`}
                  data-testid={`pipeline-inquiries-${row.school.name}`}
                >
                  <td style={first}>{`${row.school.name} · ${row.website.name}`}</td>
                  <td style={cell}>{row.received}</td>
                  <td style={cell}>{row.waiting}</td>
                  <td style={cell}>{row.contacted}</td>
                  <td style={cell}>{row.closed}</td>
                  <td style={cell}>{row.applied}</td>
                  <td style={cell}>{row.invited}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </main>
  );
}
