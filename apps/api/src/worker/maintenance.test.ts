import { describe, expect, it } from 'vitest';
import { type SystemDatabase, type SystemTransaction } from '../database/system-database';
import { MAINTENANCE_SCHEDULES, runMaintenance } from './maintenance';

function fakeDatabase(result: Record<string, number>) {
  const calls: { actor: string; sql: string }[] = [];
  const database = {
    withSystem: <T>(actor: string, work: (tx: SystemTransaction) => Promise<T>) =>
      work({
        query: <Row>(sql: string) => {
          calls.push({ actor, sql });
          return Promise.resolve([result] as Row[]);
        },
      }),
  } as unknown as SystemDatabase;
  return { database, calls };
}

describe('maintenance jobs', () => {
  it('applies admissions retention once a day', async () => {
    const { database, calls } = fakeDatabase({ erased: 3 });
    expect(await runMaintenance(database, 'admissions.apply-retention')).toEqual({ affected: 3 });
    expect(calls).toEqual([
      { actor: 'worker:admissions-retention', sql: 'SELECT admissions.apply_retention() AS erased' },
    ]);
  });

  it('expires admission offers past their deadline every minute', async () => {
    const { database, calls } = fakeDatabase({ expired: 2 });
    expect(await runMaintenance(database, 'admissions.expire-offers')).toEqual({ affected: 2 });
    expect(calls).toEqual([
      { actor: 'worker:offer-expiry', sql: 'SELECT admissions.expire_offers() AS expired' },
    ]);
    expect(
      MAINTENANCE_SCHEDULES.find((schedule) => schedule.jobName === 'admissions.expire-offers')?.pattern,
    ).toBe('* * * * *');
  });

  it('creates audit partitions three months ahead', async () => {
    const { database, calls } = fakeDatabase({ created: 1 });
    expect(await runMaintenance(database, 'audit.ensure-partitions')).toEqual({ affected: 1 });
    expect(calls).toEqual([
      { actor: 'worker:audit-partitions', sql: 'SELECT audit.ensure_partitions(3) AS created' },
    ]);
  });

  it('purges provider payloads older than 90 days', async () => {
    const { database, calls } = fakeDatabase({ purged: 4 });
    expect(await runMaintenance(database, 'integration.purge-inbound-payloads')).toEqual({ affected: 4 });
    expect(calls[0]!.sql).toContain("interval '90 days'");
  });

  it('expires unpaid orders past their reservation time', async () => {
    const { database, calls } = fakeDatabase({});
    expect(await runMaintenance(database, 'commerce.expire-reservations')).toEqual({ affected: 1 });
    expect(calls[0]).toMatchObject({ actor: 'worker:reservation-expiry' });
    expect(calls[0]!.sql).toContain("status = 'pending_payment' AND expires_at <= now()");
    expect(calls.some((call) => call.sql.includes("'commerce.order.expired'"))).toBe(true);
  });

  it('refuses unknown jobs', async () => {
    await expect(runMaintenance(fakeDatabase({}).database, 'privacy.delete-everything')).rejects.toThrow(
      'unknown',
    );
  });

  it('schedules only the jobs that need no human approval', () => {
    // Retention deletions wait for policies approved by the data protection officer (ADR 0006).
    // Offer expiry only applies the deadline staff set on each offer (M5.3). Admissions
    // retention erases only under a policy the DPO approved; the database checks it (M5.6).
    expect(MAINTENANCE_SCHEDULES.map((schedule) => schedule.id)).toEqual([
      'audit-partitions',
      'inbound-payload-purge',
      'reservation-expiry',
      'domain-verification',
      'offer-expiry',
      'admissions-retention',
    ]);
  });
});
