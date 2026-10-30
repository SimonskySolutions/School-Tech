import {
  DEFAULT_CURRENCY,
  type CreateOfferingRequest,
  type CreateSchoolRequest,
  type CreateSessionsRequest,
  type CreateStaffRequest,
  type EligibilityRules,
  type OnboardingOverview,
  type PersonId,
  type SchoolSetup,
  type SchoolWebsite,
  type SchoolId,
} from '@pythagoras/shared';
import { eligibilityFromDatabase, eligibilityToDatabase } from '../catalog/eligibility';
import { type PersonTransaction } from '../database/database';
import { dnsInstructions, GRACE_DAYS, newToken } from '../org/domains';
import { missingForActivation, schoolDays, weeklyDays } from './calendar';

// Adding a school is data, not code (M3, db/tests/12_fourth_school.sql). Every
// statement runs as the signed-in administrator, so row-level security and
// the database's own checks (codes, time zones, scopes, prices) decide what
// is allowed; this module only sequences the inserts.

/** The booking rules the seed uses for each kind, until schools edit their own. */
const DEFAULT_RULES: Record<string, Record<string, string>> = {
  lunch: {
    booking_cutoff: 'previous school day 10:00',
    cancellation_cutoff: 'previous school day 14:00',
    after_cancellation: 'account_credit',
  },
  activity: {
    booking_cutoff: 'session start minus 24 hours',
    cancellation_cutoff: 'before first session',
    after_cancellation: 'account_credit',
  },
};

export class OnboardingRejected extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

interface SchoolFacts {
  id: SchoolId;
  code: string;
  name: string;
  kind: string;
  status: string;
  time_zone: string;
  default_billing_entity_id: string;
  published_offerings: number;
  sessions: number;
  principals: number;
  offerings_without_sessions: string[];
}

const SCHOOL_FACTS = `
  SELECT s.id, s.code, s.name, s.kind, s.status, s.time_zone, s.default_billing_entity_id,
         (SELECT count(*)::int FROM catalog.school_offering o
           WHERE o.school_id = s.id AND o.status = 'published'
             AND EXISTS (SELECT 1 FROM catalog.price_version p WHERE p.offering_id = o.id)) AS published_offerings,
         (SELECT count(*)::int FROM scheduling.session x WHERE x.school_id = s.id) AS sessions,
         (SELECT count(*)::int FROM access.role_assignment r
           WHERE r.school_id = s.id AND r.role_code = 'principal' AND r.revoked_at IS NULL) AS principals,
         coalesce((SELECT array_agg(o.name ORDER BY o.name) FROM catalog.school_offering o
           WHERE o.school_id = s.id AND o.status = 'published'
             AND NOT EXISTS (SELECT 1 FROM scheduling.session x WHERE x.offering_id = o.id)), '{}') AS offerings_without_sessions
    FROM org.school s`;

function schoolView(row: SchoolFacts): OnboardingOverview['schools'][number] {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    status: row.status,
    timeZone: row.time_zone,
    billingEntityId: row.default_billing_entity_id,
    publishedOfferings: row.published_offerings,
    sessions: row.sessions,
    principals: row.principals,
    missing:
      row.status === 'draft'
        ? missingForActivation({
            status: row.status,
            publishedOfferings: row.published_offerings,
            offeringsWithoutSessions: row.offerings_without_sessions,
            principals: row.principals,
          })
        : [],
  };
}

export async function overview(tx: PersonTransaction): Promise<OnboardingOverview> {
  const billingEntities = await tx.query<{
    id: string;
    legal_name: string;
    registration_number: string;
    status: string;
  }>(
    `SELECT id, legal_name, registration_number, status FROM org.legal_entity
      WHERE group_id = access.current_group_id() ORDER BY legal_name`,
  );
  const serviceDefinitions = await tx.query<{ id: string; code: string; kind: string; name: string }>(
    `SELECT id, code, kind, name FROM catalog.service_definition
      WHERE group_id = access.current_group_id() AND status = 'active' ORDER BY kind, name`,
  );
  const schools = await tx.query<SchoolFacts>(
    `${SCHOOL_FACTS} WHERE s.group_id = access.current_group_id() ORDER BY s.name`,
  );
  return {
    billingEntities: billingEntities.map((row) => ({
      id: row.id,
      legalName: row.legal_name,
      registrationNumber: row.registration_number,
      status: row.status,
    })),
    serviceDefinitions,
    schools: schools.map(schoolView),
  };
}

async function school(tx: PersonTransaction, schoolId: string): Promise<SchoolFacts> {
  const [row] = await tx.query<SchoolFacts>(`${SCHOOL_FACTS} WHERE s.id = $1`, [schoolId]);
  if (!row) throw new OnboardingRejected(404, 'no such school');
  return row;
}

export async function createBillingEntity(
  tx: PersonTransaction,
  body: { legalName: string; registrationNumber: string; vatNumber?: string },
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO org.legal_entity (group_id, legal_name, registration_number, vat_number)
     VALUES (access.current_group_id(), $1, $2, $3) RETURNING id`,
    [body.legalName, body.registrationNumber, body.vatNumber ?? null],
  );
  return row!;
}

export async function createSchool(
  tx: PersonTransaction,
  body: CreateSchoolRequest,
): Promise<OnboardingOverview['schools'][number]> {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO org.school (group_id, code, name, kind, time_zone, default_billing_entity_id)
     VALUES (access.current_group_id(), $1, $2, $3, $4, $5) RETURNING id`,
    [body.code, body.name, body.kind, body.timeZone, body.billingEntityId],
  );
  return schoolView(await school(tx, row!.id));
}

export async function createOffering(
  tx: PersonTransaction,
  schoolId: string,
  personId: string,
  body: CreateOfferingRequest,
): Promise<{ offeringId: string; priceVersionId: string }> {
  const target = await school(tx, schoolId);
  const [definition] = await tx.query<{ id: string; code: string; kind: string }>(
    `SELECT id, code, kind FROM catalog.service_definition
      WHERE id = $1 AND group_id = access.current_group_id() AND status = 'active'`,
    [body.serviceDefinitionId],
  );
  if (!definition) throw new OnboardingRejected(422, 'no such service');
  const [offering] = await tx.query<{ id: string; group_id: string }>(
    `INSERT INTO catalog.school_offering
       (group_id, school_id, service_definition_id, billing_entity_id, code, name, status, eligibility)
     VALUES (access.current_group_id(), $1, $2, $3, $4, $5, 'published', $6) RETURNING id, group_id`,
    [
      target.id,
      definition.id,
      target.default_billing_entity_id,
      definition.code,
      body.name,
      JSON.stringify(eligibilityToDatabase(body.eligibility ?? {})),
    ],
  );
  const [price] = await tx.query<{ id: string }>(
    `INSERT INTO catalog.price_version
       (group_id, offering_id, version, currency, unit_amount_minor, vat_rate_bp, price_unit, valid_from, created_by_person_id)
     VALUES ($1, $2, 1, $7, $3, $4, $5, now(), $6) RETURNING id`,
    [
      offering!.group_id,
      offering!.id,
      body.unitAmountMinor,
      body.vatRateBp ?? 0,
      body.priceUnit,
      personId,
      DEFAULT_CURRENCY,
    ],
  );
  const rules = DEFAULT_RULES[definition.kind];
  if (rules) {
    await tx.query(
      `INSERT INTO catalog.policy_version (group_id, offering_id, kind, version, rules, valid_from, created_by_person_id)
       VALUES ($1, $2, 'booking_and_cancellation', 1, $3, now(), $4)`,
      [offering!.group_id, offering!.id, JSON.stringify(rules), personId],
    );
  }
  return { offeringId: offering!.id, priceVersionId: price!.id };
}

export async function setEligibility(
  tx: PersonTransaction,
  schoolId: string,
  offeringId: string,
  rules: EligibilityRules,
): Promise<{ offeringId: string; eligibility: EligibilityRules }> {
  const target = await school(tx, schoolId);
  const [row] = await tx.query<{ eligibility: Record<string, unknown> }>(
    `UPDATE catalog.school_offering SET eligibility = $3 WHERE id = $1 AND school_id = $2 RETURNING eligibility`,
    [offeringId, target.id, JSON.stringify(eligibilityToDatabase(rules))],
  );
  if (!row) throw new OnboardingRejected(404, 'no such offering at this school, or not yours to change');
  return { offeringId, eligibility: eligibilityFromDatabase(row.eligibility) };
}

export async function createSessions(
  tx: PersonTransaction,
  schoolId: string,
  body: CreateSessionsRequest,
): Promise<{ created: number; skipped: number }> {
  const target = await school(tx, schoolId);
  const [offering] = await tx.query<{ id: string; kind: string }>(
    `SELECT o.id, d.kind FROM catalog.school_offering o
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
      WHERE o.id = $1 AND o.school_id = $2`,
    [body.offeringId, target.id],
  );
  if (!offering) throw new OnboardingRejected(404, 'no such offering at this school');

  let dates: string[];
  try {
    dates =
      body.schedule.type === 'school_days'
        ? schoolDays(body.schedule.from, body.schedule.to, body.schedule.closed)
        : weeklyDays(body.schedule.from, body.schedule.to, body.schedule.weekday, body.schedule.closed);
  } catch (error) {
    throw new OnboardingRejected(422, error instanceof Error ? error.message : 'invalid calendar');
  }

  let created: { id: string }[];
  if (body.schedule.type === 'school_days') {
    if (offering.kind !== 'lunch') throw new OnboardingRejected(422, 'school-day calendars are for lunch');
    // Booking closes at 10:00 and cancelling at 14:00 on the day before, school time.
    created = await tx.query<{ id: string }>(
      `INSERT INTO scheduling.session
         (group_id, school_id, offering_id, service_date, capacity, location_label, booking_cutoff_at, cancellation_cutoff_at)
       SELECT access.current_group_id(), $2, $1, d, $4, $5,
              ((d - 1) + TIME '10:00') AT TIME ZONE $6, ((d - 1) + TIME '14:00') AT TIME ZONE $6
         FROM unnest($3::date[]) AS d
        WHERE NOT EXISTS (SELECT 1 FROM scheduling.session x WHERE x.offering_id = $1 AND x.service_date = d)
       RETURNING id`,
      [offering.id, target.id, dates, body.capacity, body.location ?? null, target.time_zone],
    );
  } else {
    if (offering.kind !== 'activity')
      throw new OnboardingRejected(422, 'weekly calendars are for clubs and activities');
    const { startTime, endTime } = body.schedule;
    if (endTime <= startTime) throw new OnboardingRejected(422, 'a session must end after it starts');
    // Booking closes 24 hours before each meeting.
    created = await tx.query<{ id: string }>(
      `INSERT INTO scheduling.session
         (group_id, school_id, offering_id, starts_at, ends_at, capacity, location_label, booking_cutoff_at)
       SELECT access.current_group_id(), $2, $1, starts, ends, $4, $5, starts - interval '24 hours'
         FROM unnest($3::date[]) AS d
        CROSS JOIN LATERAL (SELECT (d + $7::time) AT TIME ZONE $6 AS starts, (d + $8::time) AT TIME ZONE $6 AS ends) t
        WHERE NOT EXISTS (SELECT 1 FROM scheduling.session x WHERE x.offering_id = $1 AND x.starts_at = t.starts)
       RETURNING id`,
      [
        offering.id,
        target.id,
        dates,
        body.capacity,
        body.location ?? null,
        target.time_zone,
        startTime,
        endTime,
      ],
    );
  }
  return { created: created.length, skipped: dates.length - created.length };
}

export async function createStaff(
  tx: PersonTransaction,
  schoolId: string,
  personId: string,
  body: CreateStaffRequest,
): Promise<{ personId: string; roleCode: string }> {
  const target = await school(tx, schoolId);
  const [person] = await tx.query<{ id: string }>(
    `INSERT INTO people.person (group_id, given_name, family_name, email, registered_school_id)
     VALUES (access.current_group_id(), $1, $2, $3, $4) RETURNING id`,
    [body.givenName, body.familyName, body.email.toLowerCase(), target.id],
  );
  await tx.query(
    `INSERT INTO access.role_assignment (group_id, person_id, role_code, school_id, granted_by_person_id)
     VALUES (access.current_group_id(), $1, $2, $3, $4)`,
    [person!.id, body.roleCode, target.id, personId],
  );
  return { personId: person!.id, roleCode: body.roleCode };
}

export async function activateSchool(
  tx: PersonTransaction,
  schoolId: string,
): Promise<OnboardingOverview['schools'][number]> {
  const target = await school(tx, schoolId);
  const missing = missingForActivation({
    status: target.status,
    publishedOfferings: target.published_offerings,
    offeringsWithoutSessions: target.offerings_without_sessions,
    principals: target.principals,
  });
  if (missing.length > 0) throw new OnboardingRejected(409, `not ready: ${missing.join('; ')}`);
  await tx.query(`UPDATE org.school SET status = 'active' WHERE id = $1`, [target.id]);
  // The school's own website goes live with it.
  await tx.query(
    `UPDATE org.website SET status = 'live'
      WHERE status = 'draft'
        AND id IN (SELECT website_id FROM org.website_school WHERE school_id = $1 AND is_primary_website_for_school)`,
    [target.id],
  );
  return schoolView(await school(tx, target.id));
}

interface DomainRow {
  id: string;
  hostname: string;
  status: SchoolWebsite['hostnames'][number]['status'];
  method: SchoolWebsite['hostnames'][number]['method'];
  token: string | null;
  last_checked_at: string | null;
  missing_since: string | null;
}

function domainView(row: DomainRow): SchoolWebsite['hostnames'][number] {
  return {
    id: row.id,
    hostname: row.hostname,
    status: row.status,
    method: row.method,
    lastCheckedAt: row.last_checked_at,
    missingSince: row.missing_since,
    stopsAt: row.missing_since
      ? new Date(Date.parse(row.missing_since) + GRACE_DAYS * 86_400_000).toISOString()
      : null,
    instructions:
      row.method === 'dns_txt' && row.token && (row.status !== 'verified' || row.missing_since)
        ? dnsInstructions(row.hostname, row.token)
        : null,
  };
}

const DOMAIN_COLUMNS = `id, hostname, status, verification_method AS method, verification_token AS token,
  to_char(last_checked_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_checked_at,
  to_char(missing_since, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS missing_since`;

async function websiteOf(tx: PersonTransaction, schoolId: string): Promise<SchoolWebsite | null> {
  const [row] = await tx.query<{
    id: string;
    code: string;
    status: SchoolWebsite['status'];
    cms_tenant_key: string | null;
  }>(
    `SELECT w.id, w.code, w.status, w.cms_tenant_key
       FROM org.website_school ws JOIN org.website w ON w.id = ws.website_id
      WHERE ws.school_id = $1 AND ws.is_primary_website_for_school`,
    [schoolId],
  );
  if (!row) return null;
  const domains = await tx.query<DomainRow>(
    `SELECT ${DOMAIN_COLUMNS} FROM org.website_domain WHERE website_id = $1 ORDER BY is_primary DESC, hostname`,
    [row.id],
  );
  return {
    websiteId: row.id,
    code: row.code,
    status: row.status,
    cmsKey: row.cms_tenant_key,
    hostnames: domains.map(domainView),
  };
}

/**
 * Adds a real domain to a school's website (M3.6). It is pending until the
 * worker finds the DNS record with its token; nothing routes to it before.
 */
export async function addDomain(
  tx: PersonTransaction,
  schoolId: string,
  hostname: string,
): Promise<SchoolWebsite['hostnames'][number]> {
  const target = await school(tx, schoolId);
  const website = await websiteOf(tx, target.id);
  if (!website) throw new OnboardingRejected(409, "create the school's website first");
  const [row] = await tx.query<DomainRow>(
    `INSERT INTO org.website_domain (website_id, group_id, hostname, verification_method, verification_token, status)
     VALUES ($1, access.current_group_id(), $2, 'dns_txt', $3, 'pending')
     RETURNING ${DOMAIN_COLUMNS}`,
    [website.websiteId, hostname, newToken()],
  );
  return domainView(row!);
}

/** Asks the worker to check a domain on its next run (a failed one is tried again). */
export async function requestDomainCheck(
  tx: PersonTransaction,
  schoolId: string,
  domainId: string,
): Promise<SchoolWebsite['hostnames'][number]> {
  const target = await school(tx, schoolId);
  const website = await websiteOf(tx, target.id);
  const domain = website?.hostnames.find((entry) => entry.id === domainId);
  if (!website || !domain) throw new OnboardingRejected(404, "no such domain on this school's website");
  if (domain.status === 'verified') return domain;
  if (domain.method === 'local_development') {
    throw new OnboardingRejected(422, 'development addresses need no check');
  }
  const [row] = await tx.query<DomainRow>(
    `UPDATE org.website_domain SET status = 'pending', last_checked_at = NULL, missing_since = NULL
      WHERE id = $1 AND status IN ('pending', 'failed')
      RETURNING ${DOMAIN_COLUMNS}`,
    [domainId],
  );
  return row ? domainView(row) : domain;
}

/**
 * Gives a school its own website (or returns the one it has): code and CMS key
 * are the school's code; outside production it answers at once on
 * <code>.<devDomain>. It goes live with the school.
 */
export async function createWebsite(
  tx: PersonTransaction,
  schoolId: string,
  devDomain: string | null,
): Promise<{ website: SchoolWebsite; existing: boolean; name: string }> {
  const target = await school(tx, schoolId);
  const existing = await websiteOf(tx, target.id);
  if (existing) return { website: existing, existing: true, name: target.name };

  const [created] = await tx.query<{ id: string }>(
    `INSERT INTO org.website (group_id, code, name, purpose, default_locale, cms_tenant_key, status)
     SELECT access.current_group_id(), s.code, s.name, 'school', s.default_locale, s.code,
            CASE WHEN s.status = 'active' THEN 'live' ELSE 'draft' END
       FROM org.school s WHERE s.id = $1
     RETURNING id`,
    [target.id],
  );
  await tx.query(
    `INSERT INTO org.website_school (website_id, school_id, group_id, is_primary_website_for_school)
     VALUES ($1, $2, access.current_group_id(), true)`,
    [created!.id, target.id],
  );
  if (devDomain) {
    // Local development addresses need no proof of ownership (.localhost and .test only, ADR 0011).
    await tx.query(
      `INSERT INTO org.website_domain (website_id, group_id, hostname, is_primary, verification_method, status, verified_at)
       VALUES ($1, access.current_group_id(), $2, true, 'local_development', 'verified', now())`,
      [created!.id, `${target.code}.${devDomain}`],
    );
  }
  return { website: (await websiteOf(tx, target.id))!, existing: false, name: target.name };
}

/** One school with its offerings, calendars and staff, for the set-up page. */
export async function schoolSetup(tx: PersonTransaction, schoolId: string): Promise<SchoolSetup> {
  const target = await school(tx, schoolId);
  const [company] = await tx.query<{ legal_name: string }>(
    'SELECT legal_name FROM org.legal_entity WHERE id = $1',
    [target.default_billing_entity_id],
  );
  const serviceDefinitions = await tx.query<{ id: string; code: string; kind: string; name: string }>(
    `SELECT id, code, kind, name FROM catalog.service_definition
      WHERE group_id = access.current_group_id() AND status = 'active' ORDER BY kind, name`,
  );
  const offerings = await tx.query<{
    id: string;
    name: string;
    kind: string;
    status: string;
    unit_amount_minor: string | null;
    currency: string | null;
    price_unit: string | null;
    eligibility: Record<string, unknown>;
    sessions: number;
    first_date: string | null;
    last_date: string | null;
  }>(
    `SELECT o.id, o.name, d.kind, o.status, p.unit_amount_minor, p.currency, p.price_unit, o.eligibility,
            (SELECT count(*)::int FROM scheduling.session x WHERE x.offering_id = o.id) AS sessions,
            (SELECT to_char(min(coalesce(x.service_date, (x.starts_at AT TIME ZONE $2)::date)), 'YYYY-MM-DD')
               FROM scheduling.session x WHERE x.offering_id = o.id) AS first_date,
            (SELECT to_char(max(coalesce(x.service_date, (x.starts_at AT TIME ZONE $2)::date)), 'YYYY-MM-DD')
               FROM scheduling.session x WHERE x.offering_id = o.id) AS last_date
       FROM catalog.school_offering o
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       LEFT JOIN LATERAL (
         SELECT unit_amount_minor, currency, price_unit FROM catalog.price_version
          WHERE offering_id = o.id AND valid_from <= now() AND (valid_until IS NULL OR valid_until > now())
          ORDER BY valid_from DESC LIMIT 1
       ) p ON true
      WHERE o.school_id = $1
      ORDER BY d.kind, o.name`,
    [target.id, target.time_zone],
  );
  const staff = await tx.query<{
    person_id: PersonId;
    given_name: string;
    family_name: string;
    email: string | null;
    role_code: string;
    role_name: string;
    has_account: boolean;
  }>(
    `SELECT p.id AS person_id, p.given_name, p.family_name, p.email, r.code AS role_code, r.name AS role_name,
            EXISTS (SELECT 1 FROM people.login_identity li WHERE li.person_id = p.id AND li.disabled_at IS NULL)
              AS has_account
       FROM access.role_assignment ra
       JOIN access.role r ON r.code = ra.role_code
       JOIN people.person p ON p.id = ra.person_id
      WHERE ra.school_id = $1 AND ra.revoked_at IS NULL
      ORDER BY r.name, p.family_name, p.given_name`,
    [target.id],
  );
  return {
    school: schoolView(target),
    billingEntityName: company?.legal_name ?? '',
    website: await websiteOf(tx, target.id),
    serviceDefinitions,
    offerings: offerings.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      status: row.status,
      price:
        row.unit_amount_minor === null
          ? null
          : {
              unitAmountMinor: Number(row.unit_amount_minor),
              currency: row.currency!,
              unit: row.price_unit!,
            },
      eligibility: eligibilityFromDatabase(row.eligibility),
      sessions: row.sessions,
      firstDate: row.first_date,
      lastDate: row.last_date,
    })),
    staff: staff.map((row) => ({
      personId: row.person_id,
      name: `${row.given_name} ${row.family_name}`,
      email: row.email,
      roleCode: row.role_code,
      roleName: row.role_name,
      hasAccount: row.has_account,
    })),
  };
}
