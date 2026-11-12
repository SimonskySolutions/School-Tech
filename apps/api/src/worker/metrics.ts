import { createServer, type Server } from 'node:http';
import { type Logger } from '@nestjs/common';
import { collectDefaultMetrics, Gauge, Registry } from 'prom-client';
import { type SystemDatabase } from '../database/system-database';

// The platform's own measures for Prometheus (M8.6, ADR 0036): counts and ages
// from monitoring.platform_metrics() and the queues' job counts, read afresh
// on every scrape. Nothing here carries personal data. Served on the data
// network only; the alert rules are in infra/monitoring/rules.

export const PLATFORM_METRICS: Readonly<Record<string, string>> = {
  outbox_pending_events: 'Outbox events not yet published to the queue',
  outbox_oldest_pending_seconds: 'Age of the oldest due outbox event not yet published',
  outbox_retrying_events: 'Unpublished outbox events that failed at least three times',
  inbound_events_waiting: 'Provider webhooks received more than 15 minutes ago and not yet applied',
  inbound_events_failed: 'Provider webhooks that could not be applied',
  messages_overdue: 'E-mails due more than 15 minutes ago and not yet sent',
  messages_failed_last_day: 'E-mails given up on in the last 24 hours',
  data_subject_requests_open: 'Data subject requests not yet completed, rejected or withdrawn',
  data_subject_requests_due_within_7_days: 'Open data subject requests due within 7 days',
  data_subject_requests_overdue: 'Open data subject requests past their due date',
  audit_partitions_ahead: 'Monthly audit log partitions that exist after the current month',
  audit_default_partition_rows: 'Audit log rows in the default partition (capped at 1000)',
};

export const QUEUE_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

export interface CountedQueue {
  readonly name: string;
  getJobCounts(...types: (typeof QUEUE_STATES)[number][]): Promise<Record<string, number>>;
}

export class WorkerMetrics {
  readonly registry = new Registry();
  private readonly platform = new Map<string, Gauge>();
  private readonly queueJobs: Gauge;

  constructor(
    private readonly database: Pick<SystemDatabase, 'withSystem'>,
    private readonly queues: readonly CountedQueue[],
  ) {
    collectDefaultMetrics({ register: this.registry, prefix: 'pythagoras_worker_' });
    for (const [name, help] of Object.entries(PLATFORM_METRICS)) {
      this.platform.set(name, new Gauge({ name: `pythagoras_${name}`, help, registers: [this.registry] }));
    }
    this.queueJobs = new Gauge({
      name: 'pythagoras_queue_jobs',
      help: 'Jobs in each queue, by state',
      labelNames: ['queue', 'state'],
      registers: [this.registry],
    });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  /** Reads every measure now and renders them in Prometheus' text format. */
  async render(): Promise<string> {
    const rows = await this.database.withSystem('worker:metrics', (tx) =>
      tx.query<{ metric: string; value: number }>('SELECT metric, value FROM monitoring.platform_metrics()'),
    );
    for (const row of rows) this.platform.get(row.metric)?.set(Number(row.value));
    for (const queue of this.queues) {
      const counts = await queue.getJobCounts(...QUEUE_STATES);
      for (const state of QUEUE_STATES) this.queueJobs.set({ queue: queue.name, state }, counts[state] ?? 0);
    }
    return this.registry.metrics();
  }
}

/** GET /metrics; a measure that cannot be read answers 503, so Prometheus records the target as down. */
export function serveMetrics(metrics: WorkerMetrics, port: number, logger: Pick<Logger, 'warn'>): Server {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/metrics') {
      response.writeHead(404).end();
      return;
    }
    metrics.render().then(
      (body) => response.writeHead(200, { 'content-type': metrics.contentType }).end(body),
      (error: unknown) => {
        logger.warn(`metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
        response.writeHead(503).end();
      },
    );
  });
  server.listen(port);
  return server;
}
