import { promises as dns } from 'node:dns';
import { type SystemDatabase } from '../database/system-database';
import {
  CHECK_EVERY_MINUTES,
  GIVE_UP_AFTER_DAYS,
  GRACE_DAYS,
  hasVerificationRecord,
  RECHECK_EVERY_HOURS,
  type Resolver,
} from '../org/domains';

// Checks pending website domains for their DNS record (M3.6, ADR 0018).
// Only the worker may mark a domain verified (the API's row-level security
// refuses it), and only after finding the record with the domain's token.
// DNS is asked outside any transaction; each result is written on its own.

export interface DomainCheckResult {
  checked: number;
  verified: number;
  gaveUp: number;
  /** Verified domains looked at again, and those that stopped after their record stayed missing. */
  rechecked: number;
  lost: number;
}

export async function verifyDomains(
  database: SystemDatabase,
  resolveTxt: Resolver = (name) => dns.resolveTxt(name),
  batchSize = 50,
): Promise<DomainCheckResult> {
  const gaveUp = await database.withSystem('worker:domain-verification', (tx) =>
    tx.query<{ id: string }>(
      `UPDATE org.website_domain SET status = 'failed', last_checked_at = now()
        WHERE status = 'pending' AND verification_method = 'dns_txt'
          AND created_at < now() - make_interval(days => $1)
        RETURNING id`,
      [GIVE_UP_AFTER_DAYS],
    ),
  );

  const due = await database.withSystem('worker:domain-verification', (tx) =>
    tx.query<{ id: string; hostname: string; verification_token: string }>(
      `SELECT id, hostname, verification_token FROM org.website_domain
        WHERE status = 'pending' AND verification_method = 'dns_txt' AND verification_token IS NOT NULL
          AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(mins => $1))
        ORDER BY last_checked_at NULLS FIRST, created_at
        LIMIT $2`,
      [CHECK_EVERY_MINUTES, batchSize],
    ),
  );

  let verified = 0;
  for (const domain of due) {
    const found = await hasVerificationRecord(domain.hostname, domain.verification_token, resolveTxt);
    await database.withSystem('worker:domain-verification', async (tx) => {
      // Still pending: an administrator may have removed or changed it meanwhile.
      const updated = await tx.query<{ website_id: string; group_id: string }>(
        found
          ? `UPDATE org.website_domain SET status = 'verified', verified_at = now(), last_checked_at = now()
              WHERE id = $1 AND status = 'pending' RETURNING website_id, group_id`
          : `UPDATE org.website_domain SET last_checked_at = now()
              WHERE id = $1 AND status = 'pending' RETURNING website_id, group_id`,
        [domain.id],
      );
      if (found && updated[0]) {
        verified += 1;
        await tx.query(
          `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, 'org.website_domain', $2, 'org.domain.verified', $3)`,
          [
            updated[0].group_id,
            domain.id,
            JSON.stringify({ domain_id: domain.id, website_id: updated[0].website_id }),
          ],
        );
      }
    });
  }
  const { rechecked, lost } = await recheckVerified(database, resolveTxt, batchSize);
  return { checked: due.length, verified, gaveUp: gaveUp.length, rechecked, lost };
}

/**
 * Verified domains are checked again daily. A missing record is remembered
 * (missing_since); if it is still missing after the grace period the domain
 * becomes "failed" and is no longer routed or certified. A record that comes
 * back in time clears the warning.
 */
async function recheckVerified(
  database: SystemDatabase,
  resolveTxt: Resolver,
  batchSize: number,
): Promise<{ rechecked: number; lost: number }> {
  const due = await database.withSystem('worker:domain-verification', (tx) =>
    tx.query<{ id: string; hostname: string; verification_token: string }>(
      `SELECT id, hostname, verification_token FROM org.website_domain
        WHERE status = 'verified' AND verification_method = 'dns_txt' AND verification_token IS NOT NULL
          AND (last_checked_at IS NULL OR last_checked_at < now() - make_interval(hours => $1))
        ORDER BY last_checked_at NULLS FIRST
        LIMIT $2`,
      [RECHECK_EVERY_HOURS, batchSize],
    ),
  );
  let lost = 0;
  for (const domain of due) {
    const found = await hasVerificationRecord(domain.hostname, domain.verification_token, resolveTxt);
    await database.withSystem('worker:domain-verification', async (tx) => {
      if (found) {
        await tx.query(
          `UPDATE org.website_domain SET last_checked_at = now(), missing_since = NULL
            WHERE id = $1 AND status = 'verified'`,
          [domain.id],
        );
        return;
      }
      const [row] = await tx.query<{ status: string; website_id: string; group_id: string }>(
        `UPDATE org.website_domain
            SET last_checked_at = now(),
                missing_since = coalesce(missing_since, now()),
                status = CASE WHEN missing_since < now() - make_interval(days => $2) THEN 'failed' ELSE status END
          WHERE id = $1 AND status = 'verified'
          RETURNING status, website_id, group_id`,
        [domain.id, GRACE_DAYS],
      );
      if (row?.status === 'failed') {
        lost += 1;
        await tx.query(
          `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
           VALUES ($1, 'org.website_domain', $2, 'org.domain.lost', $3)`,
          [row.group_id, domain.id, JSON.stringify({ domain_id: domain.id, website_id: row.website_id })],
        );
      }
    });
  }
  return { rechecked: due.length, lost };
}
