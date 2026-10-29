import { readFileSync, writeFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { SystemDatabase } from '../database/system-database';
import { EventDispatcher } from './event-dispatcher';
import { MAINTENANCE_SCHEDULES, runMaintenance } from './maintenance';
import { type OutboxJobData, OutboxRelay } from './outbox-relay';
import { PaymentEventProcessor } from './payment-confirmation';
import { loadWorkerEnv } from './worker-env';

// Background worker (ADR 0002, 0004). Same package and image as the API, its
// own database role (pyth_worker) and Redis user (pyth_queue). No HTTP server.

const logger = new Logger('Worker');

async function main(): Promise<void> {
  const env = loadWorkerEnv(process.env, (path) => readFileSync(path, 'utf8'));

  const database = new SystemDatabase({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    max: env.DB_POOL_MAX,
  });

  // BullMQ does not close connections it is given, so they are tracked and closed here.
  const connections: Redis[] = [];
  const connect = () => {
    const client = new Redis({
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      username: env.REDIS_USERNAME,
      password: env.REDIS_PASSWORD,
      maxRetriesPerRequest: null,
      connectionName: 'pythagoras-worker',
    });
    connections.push(client);
    return client;
  };
  const prefix = env.QUEUE_PREFIX;

  const events = new Queue<OutboxJobData>('events', {
    connection: connect(),
    prefix,
    defaultJobOptions: {
      attempts: 8,
      backoff: { type: 'exponential', delay: 5_000 },
      // Kept long enough for the job id to deduplicate re-relayed events, then removed.
      removeOnComplete: { age: 7 * 86_400 },
      removeOnFail: { age: 30 * 86_400 },
    },
  });
  const maintenance = new Queue('maintenance', {
    connection: connect(),
    prefix,
    defaultJobOptions: {
      attempts: 3,
      removeOnComplete: { age: 30 * 86_400 },
      removeOnFail: { age: 90 * 86_400 },
    },
  });

  for (const schedule of MAINTENANCE_SCHEDULES) {
    await maintenance.upsertJobScheduler(
      schedule.id,
      { pattern: schedule.pattern, tz: 'UTC' },
      { name: schedule.jobName },
    );
  }
  // Partitions are cheap to check and must exist before the first write of a new month.
  const { affected } = await runMaintenance(database, 'audit.ensure-partitions');
  logger.log(`audit partitions checked (${affected} created)`);

  const dispatcher = new EventDispatcher();
  const eventWorker = new Worker<OutboxJobData>('events', (job) => dispatcher.dispatch(job.data), {
    connection: connect(),
    prefix,
    concurrency: env.EVENT_CONCURRENCY,
  });
  const maintenanceWorker = new Worker('maintenance', (job) => runMaintenance(database, job.name), {
    connection: connect(),
    prefix,
    concurrency: 1,
  });
  for (const worker of [eventWorker, maintenanceWorker]) {
    worker.on('failed', (job, error) =>
      logger.warn(`job ${job?.name ?? '?'} ${job?.id ?? ''} failed: ${error.message}`),
    );
    worker.on('error', (error) => logger.error(`queue error: ${error.message}`));
  }

  const relay = new OutboxRelay(database, events, logger, {
    batchSize: 100,
    intervalMs: env.OUTBOX_INTERVAL_MS,
  });
  relay.start();

  // Verified provider webhooks wait in PostgreSQL (they can hold personal data)
  // and are applied from there, never through Redis.
  const payments = new PaymentEventProcessor(database, logger);
  payments.start();

  // Liveness for Docker: a file touched while the event loop is healthy.
  const beat = () => writeFileSync(env.HEARTBEAT_FILE, new Date().toISOString());
  beat();
  const heartbeat = setInterval(beat, 10_000);

  logger.log(`worker started as ${env.DB_USER} / ${env.REDIS_USERNAME}, queues "events" and "maintenance"`);

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.log(`${signal} received, finishing current jobs`);
    clearInterval(heartbeat);
    await Promise.all([relay.stop(), payments.stop()]);
    await Promise.all([eventWorker.close(), maintenanceWorker.close()]);
    await Promise.all([events.close(), maintenance.close()]);
    await Promise.all(connections.map((client) => client.quit().catch(() => client.disconnect())));
    await database.close();
    logger.log('worker stopped');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
