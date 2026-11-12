import { type AdmissionsPipeline, type ApplicationStatus, type SchoolId } from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// The admissions pipeline (M5.5). The numbers come from two database
// functions that count and return nothing personal, for the school's
// admissions staff and for the CEO (admissions.report). The follow-ups name
// families, so they are read under row-level security and only for staff
// who work on admissions.

/** How long something may wait before it is a follow-up. */
export const FOLLOW_UP_RULES = {
  inquiryDays: 3,
  applicationDays: 7,
  offerEndsWithinDays: 3,
} as const;

const STATUSES: ApplicationStatus[] = [
  'submitted',
  'under_review',
  'waitlisted',
  'offered',
  'accepted',
  'enrolled',
  'declined',
  'expired',
  'rejected',
  'withdrawn',
];

type IntakeCountRow = {
  school_id: SchoolId;
  school_name: string;
  intake_id: string;
  school_year: string;
  grade: string;
  places: number;
  intake_status: 'open' | 'closed';
  from_inquiry: number;
} & Record<ApplicationStatus, number>;

/** Pure: an intake's numbers from its row. */
export function intakeFromRow(row: IntakeCountRow): AdmissionsPipeline['intakes'][number] {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, row[status]])) as Record<
    ApplicationStatus,
    number
  >;
  return {
    id: row.intake_id,
    school: { id: row.school_id, name: row.school_name },
    schoolYear: row.school_year,
    grade: row.grade,
    places: row.places,
    status: row.intake_status,
    free: Math.max(0, row.places - counts.offered - counts.accepted - counts.enrolled),
    counts,
    fromInquiry: row.from_inquiry,
  };
}

/** The pipeline, or null when the viewer may see neither admissions records nor their numbers. */
export async function admissionsPipeline(
  tx: PersonTransaction,
  since: string | null,
): Promise<AdmissionsPipeline | null> {
  const [access] = await tx.query<{ manage: boolean; report: boolean }>(
    `SELECT access.has_permission_anywhere('admissions.manage') AS manage,
            access.has_permission_anywhere('admissions.report') AS report`,
  );
  if (!access?.manage && !access?.report) return null;

  const intakes = await tx.query<IntakeCountRow>(
    `SELECT school_id, school_name, intake_id, school_year, grade, places, intake_status, submitted, under_review,
            waitlisted, offered, accepted, enrolled, declined, expired, rejected, withdrawn, from_inquiry
       FROM admissions.intake_counts()`,
  );
  const inquiries = await tx.query<{
    school_id: SchoolId;
    school_name: string;
    website_id: string;
    website_name: string;
    received: number;
    waiting: number;
    contacted: number;
    closed: number;
    applied: number;
    invited: number;
  }>('SELECT * FROM admissions.inquiry_counts($1::date)', [since]);

  return {
    since,
    intakes: intakes.map(intakeFromRow),
    inquiries: inquiries.map((row) => ({
      school: { id: row.school_id, name: row.school_name },
      website: { id: row.website_id, name: row.website_name },
      received: row.received,
      waiting: row.waiting,
      contacted: row.contacted,
      closed: row.closed,
      applied: row.applied,
      invited: row.invited,
    })),
    followUps: access.manage ? await followUps(tx) : null,
  };
}

async function followUps(tx: PersonTransaction): Promise<NonNullable<AdmissionsPipeline['followUps']>> {
  const rows = await tx.query<{
    kind: NonNullable<AdmissionsPipeline['followUps']>[number]['kind'];
    school_id: SchoolId;
    school_name: string;
    label: string | null;
    at: Date;
    intake_id: string | null;
  }>(
    `SELECT 'inquiry_waiting' AS kind, i.school_id, s.name AS school_name, i.parent_name AS label, i.received_at AS at,
            NULL::uuid AS intake_id
       FROM admissions.inquiry i JOIN org.school s ON s.id = i.school_id
      WHERE i.status = 'new' AND i.received_at < now() - make_interval(days => $1)
     UNION ALL
     SELECT CASE WHEN a.status = 'submitted' THEN 'application_waiting'
                 WHEN a.status = 'offered' THEN 'offer_ending' ELSE 'to_enrol' END,
            a.school_id, s.name,
            coalesce(c.given_name || ' ' || c.family_name, a.child_given_name || ' ' || a.child_family_name),
            CASE WHEN a.status = 'submitted' THEN a.submitted_at
                 WHEN a.status = 'offered' THEN a.offer_expires_at ELSE a.decided_at END,
            a.intake_id
       FROM admissions.application a
       JOIN org.school s ON s.id = a.school_id
       LEFT JOIN people.person c ON c.id = a.student_person_id
      WHERE (a.status = 'submitted' AND a.submitted_at < now() - make_interval(days => $2))
         OR (a.status = 'offered' AND a.offer_expires_at < now() + make_interval(days => $3))
         OR a.status = 'accepted'
      ORDER BY at
      LIMIT 200`,
    [FOLLOW_UP_RULES.inquiryDays, FOLLOW_UP_RULES.applicationDays, FOLLOW_UP_RULES.offerEndsWithinDays],
  );
  return rows.map((row) => ({
    kind: row.kind,
    school: { id: row.school_id, name: row.school_name },
    label: row.label,
    at: row.at.toISOString(),
    href:
      row.kind === 'inquiry_waiting'
        ? '/admissions/inquiries'
        : `/admissions/applications?intakeId=${row.intake_id ?? ''}`,
  }));
}
