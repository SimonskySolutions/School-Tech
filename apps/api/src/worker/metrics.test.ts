import { type AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type CountedQueue, PLATFORM_METRICS, serveMetrics, WorkerMetrics } from './metrics';

const database = (rows: { metric: string; value: number }[] | Error) => ({
  withSystem: vi.fn(
    async (actor: string, work: (tx: { query: () => Promise<unknown[]> }) => Promise<unknown>) => {
      expect(actor).toBe('worker:metrics');
      return work({ query: async () => (rows instanceof Error ? Promise.reject(rows) : rows) });
    },
  ),
});
const queue = (name: string, counts: Record<string, number>): CountedQueue => ({
  name,
  getJobCounts: () => Promise.resolve(counts),
});

describe('worker metrics', () => {
  const servers: { close(): void }[] = [];
  afterEach(() => servers.splice(0).forEach((server) => server.close()));

  it('reports every platform measure and the queues by state', async () => {
    const metrics = new WorkerMetrics(
      database([
        { metric: 'outbox_pending_events', value: 3 },
        { metric: 'data_subject_requests_overdue', value: 1 },
        { metric: 'not_a_known_measure', value: 9 },
      ]) as never,
      [queue('events', { waiting: 2, active: 1, delayed: 0, failed: 4 }), queue('maintenance', {})],
    );
    const text = await metrics.render();
    expect(text).toContain('pythagoras_outbox_pending_events 3');
    expect(text).toContain('pythagoras_data_subject_requests_overdue 1');
    expect(text).not.toContain('not_a_known_measure');
    for (const name of Object.keys(PLATFORM_METRICS))
      expect(text).toContain(`# TYPE pythagoras_${name} gauge`);
    expect(text).toContain('pythagoras_queue_jobs{queue="events",state="waiting"} 2');
    expect(text).toContain('pythagoras_queue_jobs{queue="events",state="failed"} 4');
    expect(text).toContain('pythagoras_queue_jobs{queue="maintenance",state="active"} 0');
    expect(text).toContain('pythagoras_worker_process_cpu_seconds_total');
  });

  it('serves /metrics, nothing else, and 503 when a measure cannot be read', async () => {
    const warn = vi.fn();
    const serve = (rows: Parameters<typeof database>[0]) => {
      const server = serveMetrics(new WorkerMetrics(database(rows) as never, []), 0, { warn });
      servers.push(server);
      return new Promise<string>((resolve) =>
        server.once('listening', () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)),
      );
    };
    const working = await serve([{ metric: 'outbox_pending_events', value: 0 }]);
    const response = await fetch(`${working}/metrics`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect((await fetch(`${working}/`)).status).toBe(404);

    const failing = await serve(new Error('connection refused'));
    expect((await fetch(`${failing}/metrics`)).status).toBe(503);
    expect(warn).toHaveBeenCalledWith('metrics unavailable: connection refused');
  });
});
