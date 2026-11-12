import {
  type ChildConsent,
  type ConsentPurposes,
  type ConsentState,
  type SchoolConsents,
  type SchoolId,
  type StudentConsents,
} from '@pythagoras/shared';
import { type PersonTransaction } from '../database/database';

// Consent from families (M6.6, ADR 0030). Reads follow row-level security
// (guardians read their children's consents, everyone the published wording);
// every write is a privacy.* function that checks who may do it.

export class ConsentRejected extends Error {
  constructor(
    readonly status: 403 | 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

const DATABASE_REFUSALS: Record<string, [ConsentRejected['status'], string]> = {
  P0002: [404, 'no such child or purpose here'],
  '42501': [403, 'not permitted'],
  '23514': [422, 'a value is not allowed here'],
  PY001: [409, 'not possible in its present state'],
};

export async function refusalsAsConsents<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
    const refusal = typeof code === 'string' ? DATABASE_REFUSALS[code] : undefined;
    if (!refusal) throw error;
    // The functions' own messages say what to do ("the wording has changed").
    throw new ConsentRejected(
      refusal[0],
      code === 'PY001' && typeof message === 'string' ? message : refusal[1],
    );
  }
}

interface ChildConsentRow {
  purpose_id: string;
  code: string;
  name: string;
  description: string;
  wording_id: string;
  version: number;
  wording: string;
  published_at: Date;
  given_at: Date | null;
  given_by: string | null;
  given_version: number | null;
  still_counts: boolean | null;
}

/** A child's consents for the guardian; null when the child is not theirs to see. */
export async function studentConsents(
  tx: PersonTransaction,
  studentId: string,
): Promise<StudentConsents | null> {
  const [student] = await tx.query<{
    id: string;
    given_name: string;
    family_name: string;
    may_consent: boolean;
  }>(
    `SELECT p.id, p.given_name, p.family_name, access.is_guardian_of(p.id, 'consent') AS may_consent
       FROM people.person p WHERE p.id = $1 AND access.is_guardian_of(p.id, 'view')`,
    [studentId],
  );
  if (!student) return null;
  const rows = await tx.query<ChildConsentRow>(
    `SELECT pp.id AS purpose_id, pp.code, pp.name, pp.description,
            w.id AS wording_id, w.version, w.wording, w.published_at,
            c.given_at, CASE WHEN g.id IS NOT NULL THEN g.given_name || ' ' || g.family_name END AS given_by,
            cw.version AS given_version, privacy.wording_still_counts(c.wording_id) AS still_counts
       FROM privacy.processing_purpose pp
       JOIN privacy.consent_wording w ON w.id = privacy.current_wording(pp.id)
       LEFT JOIN privacy.consent_record c ON c.subject_person_id = $1 AND c.purpose_id = pp.id AND c.status = 'given'
       LEFT JOIN privacy.consent_wording cw ON cw.id = c.wording_id
       LEFT JOIN people.person g ON g.id = c.given_by_person_id
      WHERE privacy.is_family_purpose(pp.id)
      ORDER BY pp.name`,
    [studentId],
  );
  return {
    student: { id: student.id, givenName: student.given_name, familyName: student.family_name },
    mayConsent: student.may_consent,
    consents: rows.map((row): ChildConsent => ({
      purposeId: row.purpose_id,
      code: row.code,
      name: row.name,
      description: row.description,
      wording: {
        id: row.wording_id,
        version: row.version,
        text: row.wording,
        publishedAt: row.published_at.toISOString(),
      },
      state: row.given_at === null ? 'none' : row.still_counts ? 'given' : 'renewal',
      givenAt: row.given_at?.toISOString() ?? null,
      givenBy: row.given_by,
      givenForVersion: row.given_version,
    })),
  };
}

export async function giveConsent(
  tx: PersonTransaction,
  studentId: string,
  purposeId: string,
  wordingId: string,
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>('SELECT privacy.give_consent($1, $2, $3) AS id', [
    studentId,
    purposeId,
    wordingId,
  ]);
  return { id: row!.id };
}

export async function withdrawConsent(
  tx: PersonTransaction,
  studentId: string,
  purposeId: string,
): Promise<{ withdrawn: true }> {
  await tx.query('SELECT privacy.withdraw_consent($1, $2)', [studentId, purposeId]);
  return { withdrawn: true };
}

/** Who may appear, per pupil and purpose, for staff who read the school's enrolments; null otherwise. */
export async function schoolConsents(
  tx: PersonTransaction,
  schoolId: string,
): Promise<SchoolConsents | null> {
  const [school] = await tx.query<{ id: SchoolId; name: string; allowed: boolean }>(
    `SELECT id, name, access.has_permission('enrolment.read', id) AS allowed FROM org.school WHERE id = $1`,
    [schoolId],
  );
  if (!school?.allowed) return null;
  const purposes = await tx.query<{ purpose_id: string; code: string; name: string }>(
    `SELECT id AS purpose_id, code, name FROM privacy.processing_purpose
      WHERE privacy.is_family_purpose(id) ORDER BY name`,
  );
  const rows = await tx.query<{
    student_person_id: string;
    given_name: string;
    family_name: string;
    class_label: string | null;
    purpose_id: string;
    state: ConsentState;
  }>('SELECT * FROM privacy.school_consents($1)', [schoolId]);
  const pupils = new Map<string, SchoolConsents['pupils'][number]>();
  for (const row of rows) {
    const pupil = pupils.get(row.student_person_id) ?? {
      personId: row.student_person_id,
      name: `${row.given_name} ${row.family_name}`,
      classLabel: row.class_label,
      states: {},
    };
    pupil.states[row.purpose_id] = row.state;
    pupils.set(row.student_person_id, pupil);
  }
  return {
    school: { id: school.id, name: school.name },
    purposes: purposes.map((purpose) => ({
      purposeId: purpose.purpose_id,
      code: purpose.code,
      name: purpose.name,
    })),
    pupils: [...pupils.values()],
  };
}

/** For the data protection officer: consent purposes with every wording; null without privacy.manage. */
export async function consentPurposes(tx: PersonTransaction): Promise<ConsentPurposes | null> {
  const [allowed] = await tx.query<{ ok: boolean }>(`SELECT access.has_permission('privacy.manage') AS ok`);
  if (!allowed?.ok) return null;
  const purposes = await tx.query<{
    id: string;
    code: string;
    name: string;
    description: string;
    status: 'draft' | 'approved' | 'retired';
    given: string;
  }>(
    `SELECT pp.id, pp.code, pp.name, pp.description, pp.status,
            (SELECT count(*) FROM privacy.consent_record c
              WHERE c.purpose_id = pp.id AND c.status = 'given' AND privacy.wording_still_counts(c.wording_id)) AS given
       FROM privacy.processing_purpose pp
      WHERE pp.lawful_basis = 'consent' AND pp.group_id = access.current_group_id()
      ORDER BY pp.name`,
  );
  const wordings = await tx.query<{
    id: string;
    purpose_id: string;
    version: number;
    wording: string;
    renewal_required: boolean;
    published_at: Date;
  }>(
    `SELECT id, purpose_id, version, wording, renewal_required, published_at
       FROM privacy.consent_wording WHERE purpose_id = ANY($1::uuid[]) ORDER BY version DESC`,
    [purposes.map((purpose) => purpose.id)],
  );
  return {
    purposes: purposes.map((purpose) => ({
      purposeId: purpose.id,
      code: purpose.code,
      name: purpose.name,
      description: purpose.description,
      status: purpose.status,
      wordings: wordings
        .filter((wording) => wording.purpose_id === purpose.id)
        .map((wording) => ({
          id: wording.id,
          version: wording.version,
          text: wording.wording,
          renewalRequired: wording.renewal_required,
          publishedAt: wording.published_at.toISOString(),
        })),
      given: Number(purpose.given),
    })),
  };
}

export async function publishWording(
  tx: PersonTransaction,
  purposeId: string,
  wording: string,
  renewalRequired: boolean,
): Promise<{ id: string }> {
  const [row] = await tx.query<{ id: string }>('SELECT privacy.publish_wording($1, $2, $3) AS id', [
    purposeId,
    wording,
    renewalRequired,
  ]);
  return { id: row!.id };
}
