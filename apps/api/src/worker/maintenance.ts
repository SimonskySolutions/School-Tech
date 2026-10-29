import { type SystemDatabase } from '../database/system-database';

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
    default:
      throw new Error(`unknown maintenance job: ${job}`);
  }
}
