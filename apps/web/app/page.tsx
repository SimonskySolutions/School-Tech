import Link from 'next/link';
import { type ReactNode } from 'react';
import { fetchMe, fetchSchools } from '../lib/api-client';
import { buildHome, type HomeView, NOTICES } from '../lib/home';
import { initials, type IconName } from '../lib/navigation';
import { currentSession, runtime } from '../lib/server';
import { Logo } from './brand';
import { DevelopmentBanner } from './development-banner';
import { Icon } from './icons';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Tone = 'violet' | 'teal' | 'amber' | 'rose' | 'sky' | 'green';

function notice(params: Record<string, string | string[] | undefined>): string | null {
  if (params['signed-out']) return NOTICES['signed-out'] ?? null;
  const error = typeof params.error === 'string' ? params.error : null;
  return error ? (NOTICES[error] ?? null) : null;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const message = notice(await searchParams);
  const session = await currentSession();

  if (!session) {
    return <SignedOut message={message} />;
  }

  const { config } = runtime();
  const [me, schools] = await Promise.all([
    fetchMe(config.API_INTERNAL_URL, session.accessToken),
    fetchSchools(config.API_INTERNAL_URL, session.accessToken),
  ]);
  if (me.kind !== 'ok') {
    return <SignedOut message={NOTICES['sign-in-failed'] ?? null} />;
  }
  return <Home view={buildHome(me.value, schools.kind === 'ok' ? schools.value : [])} />;
}

function SignedOut({ message }: { message: string | null }) {
  return (
    <div className="auth-page">
      <main className="auth-card" style={{ padding: 0 }}>
        <Logo size={56} />
        <h1>Pythagoras</h1>
        <p>One place for families and staff of the Pythagoras schools.</p>
        {message ? <p role="status">{message}</p> : null}
        <p style={{ margin: 0 }}>
          <a href="/auth/sign-in" data-testid="sign-in" className="button">
            Sign in
          </a>
        </p>
        <DevelopmentBanner />
      </main>
    </div>
  );
}

function Tile({
  href,
  testId,
  icon,
  tone = 'violet',
  title,
  text,
}: {
  href: string;
  testId?: string;
  icon: IconName;
  tone?: Tone;
  title: string;
  text?: string;
}) {
  return (
    <li>
      <Link href={href} className="tile" data-testid={testId}>
        <span className={`tile-icon ${tone}`}>
          <Icon name={icon} />
        </span>
        <span>
          <span className="tile-title">{title}</span>
          {text ? <span className="tile-text">{text}</span> : null}
        </span>
      </Link>
    </li>
  );
}

function Area({
  id,
  testId,
  title,
  aside,
  children,
}: {
  id: string;
  testId: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} data-testid={testId} className="plain">
      <div className="section-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Home({ view }: { view: HomeView }) {
  const roles = [...view.groupRoles, ...view.schoolRoles.map((entry) => `${entry.role}, ${entry.school}`)];
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <main>
      <DevelopmentBanner />
      <section className="hero">
        <p className="eyebrow">{today}</p>
        <h1>{view.greeting}</h1>
        <p>
          {view.children.length > 0 && roles.length === 0
            ? 'Everything for your children in one place: lunch and clubs, trips, messages to the school and consents.'
            : 'Here is everything you can reach today.'}
        </p>
        {roles.length > 0 ? (
          <div className="chips">
            {roles.map((role) => (
              <span key={role} className="chip">
                {role}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {view.children.length > 0 ? (
        <Area
          id="children"
          testId="children"
          title="Your children"
          aside={
            <a href="/services" data-testid="book-services" className="button">
              <Icon name="basket" /> Book lunch and clubs
            </a>
          }
        >
          <div className="card-grid">
            {view.children.map((child) => {
              const [given = '', family = ''] = child.name.split(' ');
              return (
                <article key={child.id} className="card child-card">
                  <header>
                    <span className="avatar large">{initials(given, family)}</span>
                    <span>
                      <strong>{child.name}</strong>
                      <span>{child.places.join('; ') || 'no current enrolment'}</span>
                    </span>
                  </header>
                  <nav className="action-chips" aria-label={`For ${child.name}`}>
                    <Link href={`/children/${child.id}/dietary`} data-testid="child-dietary-link">
                      <Icon name="dietary" size={14} /> Dietary needs
                    </Link>
                    <Link href={`/children/${child.id}/activities`} data-testid="child-activities-link">
                      <Icon name="registers" size={14} /> Clubs and attendance
                    </Link>
                    <Link href={`/children/${child.id}/lessons`} data-testid="child-lessons-link">
                      <Icon name="lessons" size={14} /> Lessons
                    </Link>
                    <Link href={`/children/${child.id}/trips`} data-testid="child-trips-link">
                      <Icon name="trips" size={14} /> Trips
                    </Link>
                    <Link href={`/children/${child.id}/requests`} data-testid="child-requests-link">
                      <Icon name="requests" size={14} /> Messages to the school
                    </Link>
                    <Link href={`/children/${child.id}/consents`} data-testid="child-consents-link">
                      <Icon name="photos" size={14} /> Consents
                    </Link>
                  </nav>
                </article>
              );
            })}
          </div>
        </Area>
      ) : null}

      {view.showsMyEmployment || view.showsApprovals || view.showsAccounting || view.showsConsentWording ? (
        <Area id="my-work" testId="my-work" title="Your work">
          <ul className="tiles">
            {view.showsMyEmployment ? (
              <Tile
                href="/tasks"
                testId="tasks-link"
                icon="tasks"
                title="Tasks"
                text="Yours, set by you, overdue"
              />
            ) : null}
            {view.showsApprovals ? (
              <Tile
                href="/documents/approvals"
                testId="approvals-link"
                icon="approvals"
                tone="amber"
                title="Approvals"
                text="Documents waiting for you"
              />
            ) : null}
            {view.showsMyEmployment ? (
              <Tile
                href="/staff/me"
                testId="my-employment-link"
                icon="employment"
                tone="sky"
                title="My employment"
                text="Records, training and documents"
              />
            ) : null}
            {view.showsAccounting ? (
              <Tile
                href="/accounting"
                testId="accounting-link"
                icon="accounting"
                tone="green"
                title="Accounting export"
                text="Each company's ledger"
              />
            ) : null}
            {view.showsConsentWording ? (
              <Tile
                href="/privacy/consents"
                testId="consent-wording-link"
                icon="privacy"
                tone="teal"
                title="Consent wording"
                text="What families agree to"
              />
            ) : null}
          </ul>
        </Area>
      ) : null}

      {view.schoolRoles.length > 0 ? (
        <Area id="school-roles" testId="school-roles" title="Your school">
          {view.schoolRoles.map((entry) => (
            <div key={`${entry.role}-${entry.school}`} style={{ marginBottom: 18 }}>
              <p className="muted" style={{ fontWeight: 600 }}>{`${entry.role} at ${entry.school}`}</p>
              <ul className="tiles">
                {entry.studentsHref ? (
                  <Tile
                    href={entry.studentsHref}
                    testId="students-link"
                    icon="students"
                    title="Students and families"
                    text="Enrolments and guardians"
                  />
                ) : null}
                {entry.staffHref ? (
                  <Tile
                    href={entry.staffHref}
                    testId="staff-link"
                    icon="staff"
                    tone="sky"
                    title="Staff"
                    text="Records and training"
                  />
                ) : null}
                <Tile
                  href={entry.documentsHref}
                  testId="documents-link"
                  icon="documents"
                  tone="amber"
                  title="Documents"
                  text="Private files and versions"
                />
                {entry.lessonsHref ? (
                  <Tile
                    href={entry.lessonsHref}
                    testId="lessons-link"
                    icon="lessons"
                    tone="teal"
                    title="Lessons"
                  />
                ) : null}
                {entry.uniformsHref ? (
                  <Tile
                    href={entry.uniformsHref}
                    testId="uniforms-link"
                    icon="uniforms"
                    tone="rose"
                    title="Uniforms"
                  />
                ) : null}
                {entry.consentsHref ? (
                  <Tile
                    href={entry.consentsHref}
                    testId="consents-link"
                    icon="photos"
                    tone="green"
                    title="Photo consents"
                    text="Who may appear"
                  />
                ) : null}
              </ul>
            </div>
          ))}
        </Area>
      ) : null}

      {view.groupRoles.length > 0 ? (
        <Area id="group-roles" testId="group-roles" title="Across the group">
          <p className="muted">{`${view.groupRoles.join(', ')}: all schools`}</p>
          <ul className="tiles">
            {view.groupSchools.map((school) => {
              const staff = view.staffSchools.find((entry) => entry.name === school);
              const consents = view.consentSchools.find((entry) => entry.name === school);
              return (
                <li key={school}>
                  <div className="tile" style={{ flexDirection: 'column', gap: 10 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="tile-icon">
                        <Icon name="apply" />
                      </span>
                      <span className="tile-title">{school}</span>
                    </span>
                    {staff || consents ? (
                      <span className="action-chips">
                        {staff ? (
                          <Link href={`/schools/${staff.id}/staff`} data-testid="group-staff-link">
                            <Icon name="staff" size={14} /> Staff
                          </Link>
                        ) : null}
                        {staff ? (
                          <Link href={`/schools/${staff.id}/documents`} data-testid="group-documents-link">
                            <Icon name="documents" size={14} /> Documents
                          </Link>
                        ) : null}
                        {consents ? (
                          <Link href={`/schools/${consents.id}/consents`} data-testid="group-consents-link">
                            <Icon name="photos" size={14} /> Photo consents
                          </Link>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Area>
      ) : null}

      {view.showsSchoolLife ? (
        <Area id="school-life" testId="school-life" title="School Life">
          <ul className="tiles">
            <Tile
              href="/school-life/day"
              testId="day-link"
              icon="today"
              tone="amber"
              title="Today at school"
              text="Everything in one place"
            />
            <Tile
              href="/school-life/kitchen"
              testId="kitchen-link"
              icon="kitchen"
              tone="rose"
              title="Kitchen"
              text="Lunches per day"
            />
            <Tile
              href="/school-life/registers"
              testId="registers-link"
              icon="registers"
              title="Club registers"
            />
            <Tile
              href="/school-life/menus"
              testId="menus-link"
              icon="menus"
              tone="green"
              title="Lunch menus"
            />
            <Tile
              href="/school-life/trips"
              testId="trips-link"
              icon="trips"
              tone="sky"
              title="Trips"
              text="Who is coming"
            />
            <Tile
              href="/school-life/transport"
              testId="transport-link"
              icon="transport"
              tone="teal"
              title="Transport"
              text="The day's lists for drivers"
            />
            {view.lessonSchools.map((school) => (
              <Tile
                key={`lessons-${school.id}`}
                href={`/schools/${school.id}/lessons`}
                testId="school-lessons-link"
                icon="lessons"
                tone="teal"
                title={`Lessons at ${school.name}`}
              />
            ))}
            {view.lessonSchools.map((school) => (
              <Tile
                key={`uniforms-${school.id}`}
                href={`/schools/${school.id}/uniforms`}
                testId="school-uniforms-link"
                icon="uniforms"
                tone="rose"
                title={`Uniforms at ${school.name}`}
              />
            ))}
            {view.showsRequests ? (
              <Tile
                href="/school-life/requests"
                testId="requests-link"
                icon="requests"
                title="Families' requests"
              />
            ) : null}
            {view.showsDietaryReview ? (
              <Tile
                href="/school-life/dietary"
                testId="dietary-review-link"
                icon="dietary"
                tone="green"
                title="Dietary needs to verify"
              />
            ) : null}
          </ul>
        </Area>
      ) : null}

      {view.showsAdmissions ? (
        <Area id="admissions" testId="admissions" title="Admissions">
          <ul className="tiles">
            <Tile
              href="/admissions/inquiries"
              testId="inquiries-link"
              icon="inquiries"
              tone="sky"
              title="Inquiries"
              text="From the school websites"
            />
            <Tile
              href="/admissions/applications"
              testId="applications-link"
              icon="applications"
              title="Intakes and applications"
            />
            <Tile
              href="/admissions/pipeline"
              testId="pipeline-link"
              icon="pipeline"
              tone="teal"
              title="Pipeline"
              text="Numbers, and what to follow up"
            />
          </ul>
        </Area>
      ) : null}

      {view.showsReports || view.showsSchoolSetup ? (
        <Area id="reports" testId="reports" title="Reports and set-up">
          <ul className="tiles">
            {view.showsReports ? (
              <Tile
                href="/reports/revenue"
                testId="revenue-link"
                icon="reports"
                tone="green"
                title="Revenue and balances"
                text="Per school"
              />
            ) : null}
            {view.showsAdmissionsReport ? (
              <Tile
                href="/admissions/pipeline"
                testId="admissions-report-link"
                icon="pipeline"
                tone="teal"
                title="Admissions per school"
              />
            ) : null}
            {view.showsSchoolSetup ? (
              <Tile
                href="/admin/schools"
                testId="schools-admin-link"
                icon="setup"
                tone="amber"
                title="Schools and set-up"
                text="Schools, companies and staff"
              />
            ) : null}
          </ul>
        </Area>
      ) : null}

      <Area id="apply" testId="apply-for-a-place" title="Admission to our schools">
        <ul className="tiles">
          <Tile
            href="/admissions/apply"
            testId="apply-link"
            icon="apply"
            tone="sky"
            title="Apply for a place"
            text="For a child of yours"
          />
        </ul>
      </Area>

      {view.hasNothing ? (
        <p data-testid="nothing-yet" className="card">
          Your account has no children or roles linked yet. If you expected to see your children, please
          contact the school office: a member of staff needs to confirm the link.
        </p>
      ) : null}
    </main>
  );
}
