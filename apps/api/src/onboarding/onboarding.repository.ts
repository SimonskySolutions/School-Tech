import {
  DEFAULT_CURRENCY,
  type CreateOfferingRequest,
  type CreateSchoolRequest,
  type CreateSessionsRequest,
  type CreateStaffRequest,
  type OnboardingOverview,
  type SchoolId,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';
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
    registration_number: string | null;
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
  body: { legalName: string; registrationNumber?: string; vatNumber?: string },
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>(
    `INSERT INTO org.legal_entity (group_id, legal_name, registration_number, vat_number)
     VALUES (access.current_group_id(), $1, $2, $3) RETURNING id`,
    [body.legalName, body.registrationNumber ?? null, body.vatNumber ?? null],
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
    `INSERT INTO catalog.school_offering (group_id, school_id, service_definition_id, billing_entity_id, code, name, status)
     VALUES (access.current_group_id(), $1, $2, $3, $4, $5, 'published') RETURNING id, group_id`,
    [target.id, definition.id, target.default_billing_entity_id, definition.code, body.name],
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
  return schoolView(await school(tx, target.id));
}
