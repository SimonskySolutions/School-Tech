import { type PersonTransaction } from '../database/database';

// Reads of health and dietary data are written to audit.access_log, one row
// per child whose data was shown (ADR 0006). The row says who looked, at what,
// and when; never the data itself. The policy only accepts rows for the
// signed-in person, so nobody can log in someone else's name.

export interface SensitiveRead {
  subjectPersonId: string;
  schoolId: string | null;
  recordCount: number;
}

export async function logSensitiveReads(
  tx: PersonTransaction,
  resource: string,
  reads: readonly SensitiveRead[],
): Promise<void> {
  if (reads.length === 0) return;
  await tx.query(
    `INSERT INTO audit.access_log (actor_person_id, action, resource, subject_person_id, school_id, record_count, request_id)
     SELECT app.current_person_id(), 'view', $1, r.subject, r.school, r.records, app.current_request_id()
       FROM unnest($2::uuid[], $3::uuid[], $4::int[]) AS r (subject, school, records)`,
    [
      resource,
      reads.map((read) => read.subjectPersonId),
      reads.map((read) => read.schoolId),
      reads.map((read) => read.recordCount),
    ],
  );
}

/** One read per child, counting the rows shown for them. */
export function readsPerChild<T extends { student_person_id: string; school_id: string | null }>(
  rows: readonly T[],
): SensitiveRead[] {
  const reads = new Map<string, SensitiveRead>();
  for (const row of rows) {
    const key = `${row.student_person_id}|${row.school_id ?? ''}`;
    const read = reads.get(key) ?? {
      subjectPersonId: row.student_person_id,
      schoolId: row.school_id,
      recordCount: 0,
    };
    read.recordCount += 1;
    reads.set(key, read);
  }
  return [...reads.values()];
}
