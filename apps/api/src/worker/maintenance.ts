import { type SystemDatabase } from '../database/system-database';
import { verifyDomains } from './domain-verification';
import { expireReservations } from './reservations';

// Scheduled housekeeping, run by the "maintenance" queue. Each job calls one
// security-definer function in the database that does exactly one thing.

export const MAINTENANCE_SCHEDULES = [
  {
    // Monthly partitions for the audit log, three months ahead (ADR 0006).
    id: 'audit-partitions',
    jobName: 'audit.ensure-partitions',
    pattern: '0 3 1 * *',
  },
  {
    // Provider webhook payloads are reduced to identifiers after 90 days (ADR 0006).
    id: 'inbound-payload-purge',
    jobName: 'integration.purge-inbound-payloads',
    pattern: '30 3 * * *',
  },
  {
    // Unpaid orders give their seats back when the reservation time runs out (ADR 0010).
    id: 'reservation-expiry',
    jobName: 'commerce.expire-reservations',
    pattern: '* * * * *',
  },
  {
    // Real website domains become verified once their DNS record is found (ADR 0018).
    id: 'domain-verification',
    jobName: 'org.verify-domains',
    pattern: '* * * * *',
  },
  {
    // Admission offers past their deadline expire; their places go to the waiting list (M5.3).
    id: 'offer-expiry',
    jobName: 'admissions.expire-offers',
    pattern: '* * * * *',
  },
  {
    // Unsuccessful inquiries and applications are erased after the period of the
    // group's approved retention policy; without one the database erases nothing (M5.6).
    id: 'admissions-retention',
    jobName: 'admissions.apply-retention',
    pattern: '0 4 * * *',
  },
] as const;

export type MaintenanceJob = (typeof MAINTENANCE_SCHEDULES)[number]['jobName'];

export async function runMaintenance(database: SystemDatabase, job: string): Promise<{ affected: number }> {
  switch (job) {
    case 'audit.ensure-partitions': {
      const [row] = await database.withSystem('worker:audit-partitions', (tx) =>
        tx.query<{ created: number }>('SELECT audit.ensure_partitions(3) AS created'),
      );
      return { affected: row?.created ?? 0 };
    }
    case 'integration.purge-inbound-payloads': {
      const [row] = await database.withSystem('worker:inbound-payload-purge', (tx) =>
        tx.query<{ purged: number }>(
          `SELECT integration.purge_inbound_payloads(interval '90 days') AS purged`,
        ),
      );
      return { affected: row?.purged ?? 0 };
    }
    case 'commerce.expire-reservations':
      return { affected: await expireReservations(database) };
    case 'org.verify-domains': {
      const result = await verifyDomains(database);
      return { affected: result.verified + result.gaveUp + result.lost };
    }
    case 'admissions.expire-offers': {
      const [row] = await database.withSystem('worker:offer-expiry', (tx) =>
        tx.query<{ expired: number }>('SELECT admissions.expire_offers() AS expired'),
      );
      return { affected: row?.expired ?? 0 };
    }
    case 'admissions.apply-retention': {
      const [row] = await database.withSystem('worker:admissions-retention', (tx) =>
        tx.query<{ erased: number }>('SELECT admissions.apply_retention() AS erased'),
      );
      return { affected: row?.erased ?? 0 };
    }
    default:
      throw new Error(`unknown maintenance job: ${job}`);
  }
}
