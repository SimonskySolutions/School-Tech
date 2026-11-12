import { describe, expect, it, vi } from 'vitest';
import { type SystemDatabase, type SystemTransaction } from '../database/system-database';
import { type EventQueue, type OutboxJobData, OutboxRelay, retryDelaySeconds } from './outbox-relay';

const row = (id: string, payload: Record<string, unknown>, attempts = 0) => ({
  id,
  event_id: `e0000000-0000-7000-8000-00000000000${id}`,
  group_id: 'a1000000-0000-7000-8000-000000000001',
  aggregate_type: 'commerce.order',
  aggregate_id: 'c0000000-0000-7000-8000-000000000001',
  event_type: 'commerce.order.paid',
  payload,
  occurred_at: new Date('2026-10-29T12:00:00Z'),
  attempts,
});

function fakeDatabase(rows: ReturnType<typeof row>[]) {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const actors: string[] = [];
  const tx: SystemTransaction = {
    query: <Row>(sql: string, params: readonly unknown[] = []) => {
      statements.push({ sql, params });
      return Promise.resolve((sql.trim().startsWith('SELECT') ? rows : []) as Row[]);
    },
  };
  const database = {
    withSystem: <T>(actor: string, work: (t: SystemTransaction) => Promise<T>) => {
      actors.push(actor);
      return work(tx);
    },
  } as unknown as SystemDatabase;
  return { database, statements, actors };
}

const logger = { warn: vi.fn(), error: vi.fn() };

describe('OutboxRelay', () => {
  it('enqueues each event under its own id, then marks it published, as the relay actor', async () => {
    const { database, statements, actors } = fakeDatabase([row('1', { order_id: 'x1' }), row('2', {})]);
    const added: { name: string; data: OutboxJobData; jobId: string }[] = [];
    const queue: EventQueue = {
      add: (name, data, options) => {
        added.push({ name, data, jobId: options.jobId });
        return Promise.resolve();
      },
    };
    const result = await new OutboxRelay(database, queue, logger).relayOnce();

    expect(result).toEqual({ published: 2, rejected: 0, failed: 0 });
    expect(actors).toEqual(['worker:outbox-relay']);
    expect(added.map((job) => job.jobId)).toEqual([
      'e0000000-0000-7000-8000-000000000001',
      'e0000000-0000-7000-8000-000000000002',
    ]);
    expect(added[0]!.data).toMatchObject({ eventType: 'commerce.order.paid', payload: { order_id: 'x1' } });
    expect(statements[0]!.sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(statements.filter((s) => s.sql.includes('published_at = now()'))).toHaveLength(2);
  });

  it('never sends a payload that looks like personal data, and parks the event', async () => {
    const { database, statements } = fakeDatabase([row('1', { email: 'anna@example.test' })]);
    const queue = { add: vi.fn() };
    const result = await new OutboxRelay(database, queue, logger).relayOnce();

    expect(result).toEqual({ published: 0, rejected: 1, failed: 0 });
    expect(queue.add).not.toHaveBeenCalled();
    const update = statements.find((s) => s.sql.includes("available_at = 'infinity'"))!;
    expect(update.params[1]).toContain('personal data');
  });

  it('keeps an event for retry with backoff when the queue is unavailable', async () => {
    const { database, statements } = fakeDatabase([row('1', {}, 3)]);
    const queue: EventQueue = { add: () => Promise.reject(new Error('Connection is closed.')) };
    const result = await new OutboxRelay(database, queue, logger).relayOnce();

    expect(result).toEqual({ published: 0, rejected: 0, failed: 1 });
    const update = statements.find((s) => s.sql.includes('make_interval'))!;
    expect(update.params).toEqual(['1', 'Connection is closed.', 16]);
    expect(statements.some((s) => s.sql.includes('published_at = now()'))).toBe(false);
  });

  it('backs off exponentially, capped at five minutes', () => {
    expect([0, 1, 2, 3, 10].map(retryDelaySeconds)).toEqual([2, 4, 8, 16, 300]);
  });

  it('never runs two batches at the same time', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    let calls = 0;
    const database = {
      withSystem: () => {
        calls += 1;
        return new Promise((resolve) => {
          release = () => resolve({ published: 0, rejected: 0, failed: 0 });
        });
      },
    } as unknown as SystemDatabase;
    const relay = new OutboxRelay(database, { add: vi.fn() }, logger, { batchSize: 10, intervalMs: 100 });
    relay.start();
    await vi.advanceTimersByTimeAsync(350);
    expect(calls).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(2);
    release();
    await relay.stop();
    vi.useRealTimers();
  });
});
