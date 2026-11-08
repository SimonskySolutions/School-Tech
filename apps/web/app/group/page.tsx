import { formatMoney } from '@pythagoras/shared';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { type CSSProperties } from 'react';
import { fetchGroupOverview } from '../../lib/api-client';
import { currentSession, runtime } from '../../lib/server';
import { seats } from '../../lib/timetable';
import { DevelopmentBanner } from '../development-banner';

export const dynamic = 'force-dynamic';

/** Every school on one screen: places, money, stock and queues, with a way into each. */
export default async function GroupOverviewPage() {
  const session = await currentSession();
  if (!session) redirect('/auth/sign-in');

  const { config } = runtime();
  const result = await fetchGroupOverview(config.API_INTERNAL_URL, session.accessToken);
  if (result.kind === 'signed-out') redirect('/auth/sign-in');
  if (result.kind !== 'ok') {
    return (
      <main>
        <DevelopmentBanner />
        <h1>All schools</h1>
        <p data-testid="not-permitted">This page is for those who run the group.</p>
        <p>
          <Link href="/">Home</Link>
        </p>
      </main>
    );
  }
  const view = result.value;
  const money = (minor: number) => formatMoney(minor, view.currency);
  const total = (pick: (school: (typeof view.schools)[number]) => number) =>
    view.schools.reduce((sum, school) => sum + pick(school), 0);

  return (
    <main>
      <DevelopmentBanner />
      <section className="hero" aria-labelledby="group-overview">
        <p className="eyebrow">{`School year ${view.academicYear}`}</p>
        <h1 id="group-overview">All schools</h1>
        <p>{`${view.schools.length} schools, managed from one place.`}</p>
      </section>

      <ul className="stats" data-testid="group-stats">
        <li>
          <span className="stat-value">{total((s) => s.children)}</span>
          <span className="stat-label">children enrolled</span>
        </li>
        <li>
          <span className="stat-value">{`${total((s) => s.seatsTaken)}/${total((s) => s.places)}`}</span>
          <span className="stat-label">class places taken</span>
        </li>
        <li>
          <span className="stat-value">{money(total((s) => s.incomeMinor))}</span>
          <span className="stat-label">paid by families</span>
        </li>
        <li>
          <span className="stat-value">{money(total((s) => s.spentMinor))}</span>
          <span className="stat-label">{`spent of ${money(total((s) => s.budgetMinor))}`}</span>
        </li>
      </ul>

      <div className="card-grid">
        {view.schools.map((school) => {
          const place = seats(school.seatsTaken, Math.max(school.places, 1));
          const path = `/schools/${school.id}`;
          return (
            <article key={school.id} className="card school-card" data-testid="school-overview">
              <h2>{school.name}</h2>
              <div className="class-head">
                <span className="seats">{`${school.seatsTaken} of ${school.places} places`}</span>
                {school.fullClasses > 0 ? (
                  <span className="badge full">{`${school.fullClasses} full`}</span>
                ) : null}
              </div>
              <div
                className={`meter ${place.state === 'ok' ? '' : place.state}`}
                style={{ '--value': `${place.percent}%` } as CSSProperties}
                role="img"
                aria-label={`${school.seatsTaken} of ${school.places} places taken`}
              />
              <dl className="facts">
                <div>
                  <dt>Classes</dt>
                  <dd>{school.classes}</dd>
                </div>
                <div>
                  <dt>Waiting</dt>
                  <dd>{school.waiting}</dd>
                </div>
                <div>
                  <dt>To reorder</dt>
                  <dd>{school.lowStock}</dd>
                </div>
                <div>
                  <dt>Paid in</dt>
                  <dd>{money(school.incomeMinor)}</dd>
                </div>
                <div>
                  <dt>Spent</dt>
                  <dd>{money(school.spentMinor)}</dd>
                </div>
                <div>
                  <dt>Budget</dt>
                  <dd>{money(school.budgetMinor)}</dd>
                </div>
              </dl>
              <nav className="action-chips" aria-label={school.name}>
                <Link href={`${path}/classes`}>Classes</Link>
                <Link href={`${path}/timetable`}>Timetable</Link>
                <Link href={`${path}/inventory`}>Inventory</Link>
                <Link href={`${path}/finance`}>Finance</Link>
                <Link href={`${path}/waiting-lists`}>Waiting lists</Link>
              </nav>
            </article>
          );
        })}
      </div>
    </main>
  );
}
