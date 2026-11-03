import Link from 'next/link';
import { type ReactNode } from 'react';
import { fetchSchools } from '../lib/api-client';
import { buildHome, type HomeView } from '../lib/home';
import { localeOf, type Messages } from '../lib/i18n/messages';
import { initials, type IconName } from '../lib/navigation';
import { currentMessages, currentSession, myself, runtime } from '../lib/server';
import { Logo } from './brand';
import { DevelopmentBanner } from './development-banner';
import { Icon } from './icons';
import { LanguageSwitch } from './language-switch';

export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type Tone = 'violet' | 'teal' | 'amber' | 'rose' | 'sky' | 'green';

function notice(params: Record<string, string | string[] | undefined>, notices: Record<string, string>) {
  if (params['signed-out']) return notices['signed-out'] ?? null;
  const error = typeof params.error === 'string' ? params.error : null;
  return error ? (notices[error] ?? null) : null;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const { language, text } = await currentMessages();
  const message = notice(await searchParams, text.notices);
  const session = await currentSession();

  if (!session) {
    return <SignedOut message={message} text={text} />;
  }

  const { config } = runtime();
  const [me, schools] = await Promise.all([
    myself(session.accessToken),
    fetchSchools(config.API_INTERNAL_URL, session.accessToken),
  ]);
  if (me.kind !== 'ok') {
    return <SignedOut message={text.notices['sign-in-failed'] ?? null} text={text} />;
  }
  return (
    <Home
      view={buildHome(me.value, schools.kind === 'ok' ? schools.value : [], text)}
      text={text}
      locale={localeOf(language)}
    />
  );
}

function SignedOut({ message, text }: { message: string | null; text: Messages }) {
  return (
    <div className="auth-page">
      <main className="auth-card" style={{ padding: 0 }}>
        <div className="auth-card-head">
          <Logo size={56} />
          <LanguageSwitch />
        </div>
        <h1>{text.shell.brand}</h1>
        <p>{text.home.signedOutIntro}</p>
        {message ? <p role="status">{message}</p> : null}
        <p style={{ margin: 0 }}>
          <a href="/auth/sign-in" data-testid="sign-in" className="button">
            {text.home.signIn}
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

function Home({ view, text, locale }: { view: HomeView; text: Messages; locale: string }) {
  const t = text.home;
  const roles = [
    ...view.groupRoles,
    ...view.schoolRoles.map((entry) => t.roleChip(entry.role, entry.school)),
  ];
  const today = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <main>
      <DevelopmentBanner />
      <section className="hero">
        <p className="eyebrow">{today}</p>
        <h1>{view.greeting}</h1>
        <p>{view.children.length > 0 && roles.length === 0 ? t.familyIntro : t.intro}</p>
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
          title={t.yourChildren}
          aside={
            <a href="/services" data-testid="book-services" className="button">
              <Icon name="basket" /> {text.nav.bookLunchAndClubs}
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
                      <span>{child.places.join('; ') || t.noEnrolment}</span>
                    </span>
                  </header>
                  <nav className="action-chips" aria-label={t.forChild(child.name)}>
                    <Link href={`/children/${child.id}/dietary`} data-testid="child-dietary-link">
                      <Icon name="dietary" size={14} /> {t.dietaryNeeds}
                    </Link>
                    <Link href={`/children/${child.id}/activities`} data-testid="child-activities-link">
                      <Icon name="registers" size={14} /> {t.clubsAndAttendance}
                    </Link>
                    <Link href={`/children/${child.id}/lessons`} data-testid="child-lessons-link">
                      <Icon name="lessons" size={14} /> {t.lessons}
                    </Link>
                    <Link href={`/children/${child.id}/trips`} data-testid="child-trips-link">
                      <Icon name="trips" size={14} /> {t.trips}
                    </Link>
                    <Link href={`/children/${child.id}/requests`} data-testid="child-requests-link">
                      <Icon name="requests" size={14} /> {t.messagesToSchool}
                    </Link>
                    <Link href={`/children/${child.id}/consents`} data-testid="child-consents-link">
                      <Icon name="photos" size={14} /> {t.consents}
                    </Link>
                  </nav>
                </article>
              );
            })}
          </div>
        </Area>
      ) : null}

      {view.showsMyEmployment || view.showsApprovals || view.showsAccounting || view.showsConsentWording ? (
        <Area id="my-work" testId="my-work" title={t.yourWork}>
          <ul className="tiles">
            {view.showsMyEmployment ? (
              <Tile href="/tasks" testId="tasks-link" icon="tasks" title={t.tasks} text={t.tasksText} />
            ) : null}
            {view.showsApprovals ? (
              <Tile
                href="/documents/approvals"
                testId="approvals-link"
                icon="approvals"
                tone="amber"
                title={t.approvals}
                text={t.approvalsText}
              />
            ) : null}
            {view.showsMyEmployment ? (
              <Tile
                href="/staff/me"
                testId="my-employment-link"
                icon="employment"
                tone="sky"
                title={t.myEmployment}
                text={t.myEmploymentText}
              />
            ) : null}
            {view.showsAccounting ? (
              <Tile
                href="/accounting"
                testId="accounting-link"
                icon="accounting"
                tone="green"
                title={t.accountingExport}
                text={t.accountingExportText}
              />
            ) : null}
            {view.showsConsentWording ? (
              <Tile
                href="/privacy/consents"
                testId="consent-wording-link"
                icon="privacy"
                tone="teal"
                title={t.consentWording}
                text={t.consentWordingText}
              />
            ) : null}
          </ul>
        </Area>
      ) : null}

      {view.schoolRoles.length > 0 ? (
        <Area id="school-roles" testId="school-roles" title={t.yourSchool}>
          {view.schoolRoles.map((entry) => (
            <div key={`${entry.role}-${entry.school}`} style={{ marginBottom: 18 }}>
              <p className="muted" style={{ fontWeight: 600 }}>
                {t.roleAt(entry.role, entry.school)}
              </p>
              <ul className="tiles">
                {entry.studentsHref ? (
                  <Tile
                    href={entry.studentsHref}
                    testId="students-link"
                    icon="students"
                    title={t.studentsAndFamilies}
                    text={t.studentsAndFamiliesText}
                  />
                ) : null}
                {entry.staffHref ? (
                  <Tile
                    href={entry.staffHref}
                    testId="staff-link"
                    icon="staff"
                    tone="sky"
                    title={t.staff}
                    text={t.staffText}
                  />
                ) : null}
                <Tile
                  href={entry.documentsHref}
                  testId="documents-link"
                  icon="documents"
                  tone="amber"
                  title={t.documents}
                  text={t.documentsText}
                />
                {entry.lessonsHref ? (
                  <Tile
                    href={entry.lessonsHref}
                    testId="lessons-link"
                    icon="lessons"
                    tone="teal"
                    title={t.lessons}
                  />
                ) : null}
                {entry.uniformsHref ? (
                  <Tile
                    href={entry.uniformsHref}
                    testId="uniforms-link"
                    icon="uniforms"
                    tone="rose"
                    title={t.uniforms}
                  />
                ) : null}
                {entry.consentsHref ? (
                  <Tile
                    href={entry.consentsHref}
                    testId="consents-link"
                    icon="photos"
                    tone="green"
                    title={t.photoConsents}
                    text={t.photoConsentsText}
                  />
                ) : null}
              </ul>
            </div>
          ))}
        </Area>
      ) : null}

      {view.groupRoles.length > 0 ? (
        <Area id="group-roles" testId="group-roles" title={t.acrossGroup}>
          <p className="muted">{t.allSchools(view.groupRoles.join(', '))}</p>
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
                            <Icon name="staff" size={14} /> {t.staff}
                          </Link>
                        ) : null}
                        {staff ? (
                          <Link href={`/schools/${staff.id}/documents`} data-testid="group-documents-link">
                            <Icon name="documents" size={14} /> {t.documents}
                          </Link>
                        ) : null}
                        {consents ? (
                          <Link href={`/schools/${consents.id}/consents`} data-testid="group-consents-link">
                            <Icon name="photos" size={14} /> {t.photoConsents}
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
        <Area id="school-life" testId="school-life" title={t.schoolLife}>
          <ul className="tiles">
            <Tile
              href="/school-life/day"
              testId="day-link"
              icon="today"
              tone="amber"
              title={t.todayAtSchool}
              text={t.todayAtSchoolText}
            />
            <Tile
              href="/school-life/kitchen"
              testId="kitchen-link"
              icon="kitchen"
              tone="rose"
              title={t.kitchen}
              text={t.kitchenText}
            />
            <Tile
              href="/school-life/registers"
              testId="registers-link"
              icon="registers"
              title={t.clubRegisters}
            />
            <Tile
              href="/school-life/menus"
              testId="menus-link"
              icon="menus"
              tone="green"
              title={t.lunchMenus}
            />
            <Tile
              href="/school-life/trips"
              testId="trips-link"
              icon="trips"
              tone="sky"
              title={t.trips}
              text={t.tripsText}
            />
            <Tile
              href="/school-life/transport"
              testId="transport-link"
              icon="transport"
              tone="teal"
              title={t.transport}
              text={t.transportText}
            />
            {view.lessonSchools.map((school) => (
              <Tile
                key={`lessons-${school.id}`}
                href={`/schools/${school.id}/lessons`}
                testId="school-lessons-link"
                icon="lessons"
                tone="teal"
                title={t.lessonsAt(school.name)}
              />
            ))}
            {view.lessonSchools.map((school) => (
              <Tile
                key={`uniforms-${school.id}`}
                href={`/schools/${school.id}/uniforms`}
                testId="school-uniforms-link"
                icon="uniforms"
                tone="rose"
                title={t.uniformsAt(school.name)}
              />
            ))}
            {view.showsRequests ? (
              <Tile
                href="/school-life/requests"
                testId="requests-link"
                icon="requests"
                title={t.familiesRequests}
              />
            ) : null}
            {view.showsDietaryReview ? (
              <Tile
                href="/school-life/dietary"
                testId="dietary-review-link"
                icon="dietary"
                tone="green"
                title={t.dietaryToVerify}
              />
            ) : null}
          </ul>
        </Area>
      ) : null}

      {view.showsAdmissions ? (
        <Area id="admissions" testId="admissions" title={t.admissions}>
          <ul className="tiles">
            <Tile
              href="/admissions/inquiries"
              testId="inquiries-link"
              icon="inquiries"
              tone="sky"
              title={t.inquiries}
              text={t.inquiriesText}
            />
            <Tile
              href="/admissions/applications"
              testId="applications-link"
              icon="applications"
              title={t.intakesAndApplications}
            />
            <Tile
              href="/admissions/pipeline"
              testId="pipeline-link"
              icon="pipeline"
              tone="teal"
              title={t.pipeline}
              text={t.pipelineText}
            />
          </ul>
        </Area>
      ) : null}

      {view.showsReports || view.showsSchoolSetup ? (
        <Area id="reports" testId="reports" title={t.reportsAndSetup}>
          <ul className="tiles">
            {view.showsReports ? (
              <Tile
                href="/reports/revenue"
                testId="revenue-link"
                icon="reports"
                tone="green"
                title={t.revenue}
                text={t.revenueText}
              />
            ) : null}
            {view.showsAdmissionsReport ? (
              <Tile
                href="/admissions/pipeline"
                testId="admissions-report-link"
                icon="pipeline"
                tone="teal"
                title={t.admissionsPerSchool}
              />
            ) : null}
            {view.showsSchoolSetup ? (
              <Tile
                href="/admin/schools"
                testId="schools-admin-link"
                icon="setup"
                tone="amber"
                title={t.schoolsAndSetup}
                text={t.schoolsAndSetupText}
              />
            ) : null}
          </ul>
        </Area>
      ) : null}

      <Area id="apply" testId="apply-for-a-place" title={t.admissionToSchools}>
        <ul className="tiles">
          <Tile
            href="/admissions/apply"
            testId="apply-link"
            icon="apply"
            tone="sky"
            title={t.applyForPlace}
            text={t.applyForPlaceText}
          />
        </ul>
      </Area>

      {view.hasNothing ? (
        <p data-testid="nothing-yet" className="card">
          {t.nothingYet}
        </p>
      ) : null}
    </main>
  );
}
