import { readFileSync } from 'node:fs';
import { Job, Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Runs against the real stack: the worker service, PostgreSQL and Redis.
// Events are written exactly as the API writes them (as pyth_api), tagged with
// aggregate type "test.worker" so the test script can remove them afterwards.

const GROUP = 'a1000000-0000-7000-8000-000000000001';
const secret = (name: string) => readFileSync(`/workspace/secrets/${name}`, 'utf8').trim();

const asRole = async (user: string, password: string) => {
  const client = new Client({ host: 'postgres', database: 'pythagoras', user, password });
  await client.connect();
  return client;
};

let api: Client;
let worker: Client;
let redis: Redis;
let events: Queue;
let maintenance: Queue;

beforeAll(async () => {
  api = await asRole('pyth_api', secret('pg_api_password'));
  worker = await asRole('pyth_worker', secret('pg_worker_password'));
  const connection = () =>
    new Redis({
      host: 'redis',
      username: 'pyth_queue',
      password: secret('redis_queue_password'),
      maxRetriesPerRequest: null,
    });
  redis = connection();
  events = new Queue('events', { connection: connection(), prefix: 'pyth' });
  maintenance = new Queue('maintenance', { connection: connection(), prefix: 'pyth' });
});

afterAll(async () => {
  await Promise.all([api.end(), worker.end(), events.close(), maintenance.close()]);
  redis.disconnect();
});

/** Writes an outbox event as the API does, and returns its event id (read back as the worker). */
async function emit(eventType: string, payload: Record<string, unknown>): Promise<string> {
  const aggregateId = crypto.randomUUID();
  await api.query(
    `INSERT INTO integration.outbox_event (group_id, aggregate_type, aggregate_id, event_type, payload)
     VALUES ($1, 'test.worker', $2, $3, $4)`,
    [GROUP, aggregateId, eventType, JSON.stringify(payload)],
  );
  const { rows } = await worker.query<{ event_id: string }>(
    'SELECT event_id FROM integration.outbox_event WHERE aggregate_id = $1',
    [aggregateId],
  );
  return rows[0]!.event_id;
}

async function waitFor<T>(probe: () => Promise<T | null | undefined>, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe('worker', () => {
  it('is connected as its own database role', async () => {
    const { rows } = await worker.query<{ usename: string }>(
      `SELECT DISTINCT usename FROM pg_stat_activity WHERE application_name = 'pythagoras-worker'`,
    );
    expect(rows.map((row) => row.usename)).toEqual(['pyth_worker']);
  });

  it('relays an outbox event to the queue and processes it', async () => {
    const eventId = await emit('test.worker.ping', { order_id: crypto.randomUUID(), status: 'paid' });

    const published = await waitFor(async () => {
      const { rows } = await worker.query<{ published_at: Date | null }>(
        'SELECT published_at FROM integration.outbox_event WHERE event_id = $1',
        [eventId],
      );
      return rows[0]?.published_at;
    });
    expect(published).toBeInstanceOf(Date);

    const job = await waitFor(async () => {
      const found = await Job.fromId(events, eventId);
      return found?.finishedOn ? found : null;
    });
    expect(job.name).toBe('test.worker.ping');
    expect(job.returnvalue).toBe('no-handler');
    expect(job.data).toMatchObject({ eventId, eventType: 'test.worker.ping', groupId: GROUP });
  });

  it('refuses to put personal data into Redis and parks the event', async () => {
    const eventId = await emit('test.worker.leak', { email: 'anna.ivanova@pythagoras.test' });

    const parked = await waitFor(async () => {
      const { rows } = await worker.query<{ last_error: string | null; published_at: Date | null }>(
        'SELECT last_error, published_at FROM integration.outbox_event WHERE event_id = $1',
        [eventId],
      );
      return rows[0]?.last_error ? rows[0] : null;
    });
    expect(parked.last_error).toContain('personal data');
    expect(parked.published_at).toBeNull();
    expect(await Job.fromId(events, eventId)).toBeUndefined();
    expect(await redis.exists(`pyth:events:${eventId}`)).toBe(0);
  });

  it('has registered the scheduled maintenance jobs', async () => {
    const schedulers = await maintenance.getJobSchedulers();
    expect(Object.fromEntries(schedulers.map((s) => [s.key, s.pattern]))).toEqual({
      'audit-partitions': '0 3 1 * *',
      'inbound-payload-purge': '30 3 * * *',
      'reservation-expiry': '* * * * *',
      'domain-verification': '* * * * *',
      'offer-expiry': '* * * * *',
    });
  });

  it('may expire admission offers, as its job does', async () => {
    const { rows } = await worker.query<{ expired: number }>('SELECT admissions.expire_offers() AS expired');
    expect(rows[0]!.expired).toBeGreaterThanOrEqual(0);
  });

  it('keeps audit-log partitions ready for the next three months', async () => {
    const { rows } = await worker.query<{ name: string }>(
      `SELECT c.relname AS name FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'audit.change_log'::regclass`,
    );
    const names = rows.map((row) => row.name);
    const month = new Date();
    for (let ahead = 0; ahead <= 3; ahead += 1) {
      const d = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + ahead, 1));
      expect(names).toContain(
        `change_log_${d.getUTCFullYear()}_${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      );
    }
  });
});
