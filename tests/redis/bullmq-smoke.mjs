// Proves that BullMQ works under the pyth_queue ACL user: a producer adds a
// job, a worker processes it, and queue events report completion. Keys use
// the "pyth" prefix required by the ACL. Payloads carry identifiers only.
import { Queue, QueueEvents, Worker } from 'bullmq';
import { Redis } from 'ioredis';

// BullMQ 6 takes a client instance in native ESM; each role gets its own
// connection. BullMQ does not close connections it was given, so we do.
const connections = [];
const connect = () => {
  const client = new Redis({
    host: process.env.REDIS_HOST ?? 'redis',
    port: Number(process.env.REDIS_PORT ?? 6379),
    username: 'pyth_queue',
    password: process.env.REDIS_PASSWORD,
    maxRetriesPerRequest: null,
  });
  connections.push(client);
  return client;
};
const prefix = 'pyth';
const name = `smoke-${Date.now()}`;

const queue = new Queue(name, { connection: connect(), prefix });
const events = new QueueEvents(name, { connection: connect(), prefix });
const worker = new Worker(name, async (job) => ({ handled: job.data.orderId }), { connection: connect(), prefix });

const failures = [];
worker.on('error', (err) => failures.push(`worker: ${err.message}`));
queue.on('error', (err) => failures.push(`queue: ${err.message}`));

try {
  await events.waitUntilReady();
  const job = await queue.add(
    'order.confirmation',
    { orderId: '00000000-0000-7000-8000-000000000001' },
    { attempts: 3, removeOnComplete: { age: 86400 }, removeOnFail: { age: 14 * 86400 } },
  );
  const result = await job.waitUntilFinished(events, 15000);
  if (result?.handled !== job.data.orderId) throw new Error(`unexpected result ${JSON.stringify(result)}`);

  const delayed = await queue.add('reservation.expiry', { bookingId: 'b1' }, { delay: 60000 });
  const counts = await queue.getJobCounts('delayed', 'completed');
  if (counts.delayed !== 1) throw new Error(`expected 1 delayed job, got ${JSON.stringify(counts)}`);
  await delayed.remove();

  if (failures.length) throw new Error(failures.join('; '));
  console.log(`ok - BullMQ job processed under ACL user pyth_queue (${JSON.stringify(counts)})`);
} catch (err) {
  console.error(`not ok - ${err.message}`);
  process.exitCode = 1;
} finally {
  await worker.close();
  await queue.obliterate({ force: true }).catch((err) => console.error(`cleanup: ${err.message}`));
  await queue.close();
  await events.close();
  await Promise.all(connections.map((client) => client.quit().catch(() => client.disconnect())));
}
