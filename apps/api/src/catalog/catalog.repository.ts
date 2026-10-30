import { type PersonTransaction } from '../database/database';

// Catalog reads for booking. Row-level security limits enrolments to children
// the person may see; offerings, sessions and prices shown are published ones.

export interface StudentRow {
  id: string;
  given_name: string;
  family_name: string;
}

export interface OfferingRow {
  id: string;
  kind: 'lunch' | 'activity';
  name: string;
  school_id: string;
  school_name: string;
  billing_entity_id: string;
  billing_entity_name: string;
  price_version_id: string;
  unit_amount_minor: string;
  currency: string;
  price_unit: string;
  vat_rate_bp: number;
  eligibility: Record<string, unknown>;
}

export interface SessionRow {
  id: string;
  offering_id: string;
  service_date: string | null;
  starts_at: Date | null;
  ends_at: Date | null;
  location_label: string | null;
  available: number | null;
  booking_cutoff_at: Date | null;
}

/** Bookable kinds in the family portal. Tuition is invoiced by staff. */
export const BOOKABLE_KINDS = ['lunch', 'activity'] as const;

/** Lunch is bought per day; other kinds are bought as the whole set of sessions. */
export const pickSessions = (kind: string, priceUnit: string) =>
  kind === 'lunch' || priceUnit === 'per_day' || priceUnit === 'per_session';

export async function findStudentWithSchools(
  tx: PersonTransaction,
  studentId: string,
): Promise<{ student: StudentRow; schoolIds: string[] } | null> {
  const [student] = await tx.query<StudentRow>(
    'SELECT id, given_name, family_name FROM people.person WHERE id = $1',
    [studentId],
  );
  if (!student) return null;
  const schools = await tx.query<{ school_id: string }>(
    `SELECT DISTINCT school_id FROM people.enrolment
      WHERE student_person_id = $1 AND status = 'active'
        AND start_date <= current_date AND (end_date IS NULL OR end_date > current_date)`,
    [studentId],
  );
  return { student, schoolIds: schools.map((row) => row.school_id) };
}

export function findBookableOfferings(
  tx: PersonTransaction,
  schoolIds: readonly string[],
  offeringIds?: readonly string[],
): Promise<OfferingRow[]> {
  return tx.query<OfferingRow>(
    `SELECT o.id, d.kind, o.name, o.school_id, s.name AS school_name,
            o.billing_entity_id, le.legal_name AS billing_entity_name,
            pv.id AS price_version_id, pv.unit_amount_minor, pv.currency, pv.price_unit, pv.vat_rate_bp,
            o.eligibility
       FROM catalog.school_offering o
       JOIN catalog.service_definition d ON d.id = o.service_definition_id
       JOIN org.school s ON s.id = o.school_id
       JOIN org.legal_entity le ON le.id = o.billing_entity_id
       JOIN LATERAL (
              SELECT * FROM catalog.price_version p
               WHERE p.offering_id = o.id AND p.valid_from <= now() AND (p.valid_until IS NULL OR p.valid_until > now())
               ORDER BY p.valid_from DESC LIMIT 1) pv ON true
      WHERE o.school_id = ANY ($1::uuid[])
        AND o.status = 'published'
        AND d.kind = ANY ($2::text[])
        AND (o.booking_opens_at IS NULL OR o.booking_opens_at <= now())
        AND (o.booking_closes_at IS NULL OR o.booking_closes_at > now())
        AND ($3::uuid[] IS NULL OR o.id = ANY ($3::uuid[]))
      ORDER BY s.name, d.kind DESC, o.name`,
    [schoolIds, BOOKABLE_KINDS, offeringIds ?? null],
  );
}

/** Sessions still open for booking (scheduled, in the future, before their cutoff). */
export function findOpenSessions(
  tx: PersonTransaction,
  offeringIds: readonly string[],
): Promise<SessionRow[]> {
  return tx.query<SessionRow>(
    `SELECT id, offering_id, to_char(service_date, 'YYYY-MM-DD') AS service_date, starts_at, ends_at,
            location_label,
            CASE WHEN capacity IS NULL THEN NULL ELSE capacity - reserved_count - confirmed_count END AS available,
            booking_cutoff_at
       FROM scheduling.session
      WHERE offering_id = ANY ($1::uuid[])
        AND status = 'scheduled'
        AND (booking_cutoff_at IS NULL OR booking_cutoff_at > now())
        AND coalesce(starts_at, service_date::timestamptz) > now()
      ORDER BY coalesce(starts_at, service_date::timestamptz), id`,
    [offeringIds],
  );
}

export async function findBookedSessionIds(tx: PersonTransaction, studentId: string): Promise<Set<string>> {
  const rows = await tx.query<{ session_id: string }>(
    `SELECT session_id FROM scheduling.booking
      WHERE student_person_id = $1 AND status IN ('reserved', 'confirmed', 'attended', 'absent')`,
    [studentId],
  );
  return new Set(rows.map((row) => row.session_id));
}

/**
 * Why the child may not take each offering (absent when they may), judged on
 * the offering's first open day. The database checks every booking again,
 * on that session's own day.
 */
export async function findEligibilityProblems(
  tx: PersonTransaction,
  studentId: string,
  offerings: readonly { id: string; firstDay: string | null }[],
): Promise<Map<string, string>> {
  if (offerings.length === 0) return new Map();
  const rows = await tx.query<{ offering_id: string; problem: string | null }>(
    `SELECT v.offering_id, catalog.eligibility_problem(v.offering_id, $1, coalesce(v.first_day, current_date)) AS problem
       FROM unnest($2::uuid[], $3::date[]) AS v (offering_id, first_day)`,
    [studentId, offerings.map((o) => o.id), offerings.map((o) => o.firstDay)],
  );
  return new Map(rows.flatMap((row) => (row.problem ? [[row.offering_id, row.problem] as const] : [])));
}
