import { type SystemDatabase } from '../database/system-database';
import { checkPayload } from './payload-guard';

// Moves committed outbox events from PostgreSQL to the BullMQ "events" queue
// (ADR 0002). PostgreSQL stays the source of truth: an event is marked
// published only after the queue accepted it, and the BullMQ job id is the
// event id, so a retry after a crash cannot enqueue the same event twice while
// the job is still kept. Delivery is at least once; consumers are idempotent.

export interface OutboxJobData {
  eventId: string;
  groupId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface EventQueue {
  add(name: string, data: OutboxJobData, options: { jobId: string }): Promise<unknown>;
}

export interface RelayLogger {
  warn(message: string): void;
  error(message: string): void;
}

interface OutboxRow {
  id: string;
  event_id: string;
  group_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  occurred_at: Date;
  attempts: number;
}

export interface RelayResult {
  published: number;
  rejected: number;
  failed: number;
}

/** Retry delay after a failed enqueue: 2, 4, 8 ... seconds, capped at 5 minutes. */
export function retryDelaySeconds(attempts: number): number {
  return Math.min(300, 2 ** Math.max(1, attempts + 1));
}

export class OutboxRelay {
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<unknown> | undefined;

  constructor(
    private readonly database: SystemDatabase,
    private readonly queue: EventQueue,
    private readonly logger: RelayLogger,
    private readonly options: { batchSize: number; intervalMs: number } = {
      batchSize: 100,
      intervalMs: 1000,
    },
  ) {}

  /** Publishes one batch of due events. Rows are locked so parallel relays never take the same event. */
  relayOnce(): Promise<RelayResult> {
    return this.database.withSystem('worker:outbox-relay', async (tx) => {
      const rows = await tx.query<OutboxRow>(
        `SELECT id, event_id, group_id, aggregate_type, aggregate_id, event_type, payload, occurred_at, attempts
           FROM integration.outbox_event
          WHERE published_at IS NULL AND available_at <= now()
          ORDER BY id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [this.options.batchSize],
      );
      const result: RelayResult = { published: 0, rejected: 0, failed: 0 };

      for (const row of rows) {
        const problem = checkPayload(row.payload);
        if (problem) {
          // A programming error, not a transient failure: park it and alert, never send it.
          await tx.query(
            `UPDATE integration.outbox_event
                SET attempts = attempts + 1, last_error = $2, available_at = 'infinity'
              WHERE id = $1`,
            [row.id, `refused: payload may contain personal data (${problem})`],
          );
          this.logger.error(`outbox event ${row.event_id} (${row.event_type}) refused: ${problem}`);
          result.rejected += 1;
          continue;
        }
        try {
          await this.queue.add(
            row.event_type,
            {
              eventId: row.event_id,
              groupId: row.group_id,
              aggregateType: row.aggregate_type,
              aggregateId: row.aggregate_id,
              eventType: row.event_type,
              payload: row.payload,
              occurredAt: row.occurred_at.toISOString(),
            },
            { jobId: row.event_id },
          );
          await tx.query(
            `UPDATE integration.outbox_event SET published_at = now(), attempts = attempts + 1, last_error = NULL
              WHERE id = $1`,
            [row.id],
          );
          result.published += 1;
        } catch (error) {
          const delay = retryDelaySeconds(row.attempts);
          await tx.query(
            `UPDATE integration.outbox_event
                SET attempts = attempts + 1, last_error = $2, available_at = now() + make_interval(secs => $3)
              WHERE id = $1`,
            [row.id, error instanceof Error ? error.message.slice(0, 500) : 'enqueue failed', delay],
          );
          this.logger.warn(`outbox event ${row.event_id} not enqueued, retry in ${delay}s`);
          result.failed += 1;
        }
      }
      return result;
    });
  }

  start(): void {
    this.timer = setInterval(() => {
      if (this.running) return; // never overlap batches
      this.running = this.relayOnce()
        .catch((error: unknown) =>
          this.logger.error(
            `outbox relay batch failed: ${error instanceof Error ? error.message : 'unknown'}`,
          ),
        )
        .finally(() => {
          this.running = undefined;
        });
    }, this.options.intervalMs);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
}
