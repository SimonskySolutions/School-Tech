import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { post, secret, tokenFor } from './helpers';

// Reminders (M7.3, ADR 0031) against the real stack: the worker's daily job is
// run as the worker would run it, and the messages arrive in the development
// mailbox. The seed has the principal of School A's overdue stage booking and
// School A staff whose checks and qualifications need seeing to; the test adds
// a task for the kitchen due tomorrow.

const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const run = Date.now().toString(36);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

interface Mail {
  ID: string;
}
async function arrived(to: string, subject: string): Promise<Mail[]> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`);
    const found = (
      (await (await fetch(`${MAILPIT}/api/v1/search?query=${query}`)).json()) as { messages: Mail[] }
    ).messages;
    if (found.length > 0 || Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const text = async (mail: Mail) =>
  ((await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as { Text: string }).Text;

let worker: Client;

beforeAll(async () => {
  worker = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_worker',
    password: secret('pg_worker_password'),
  });
  await worker.connect();
});
afterAll(() => worker.end());

describe('reminders', () => {
  it('remind people of tasks due tomorrow and overdue, and leaders of staff records', async () => {
    const title = `Order the bread (${run})`;
    const created = await post(await tokenFor('principal.a'), '/tasks', {
      title,
      assigneeId: KITCHEN_A,
      schoolId: SCHOOL_A,
      dueOn: tomorrow,
    });
    expect(created.status).toBe(201);

    await worker.query(`SELECT set_config('app.actor', 'worker:reminders-test', false)`);
    const { rows } = await worker.query<{ kind: string; queued: number }>(
      'SELECT * FROM notify.queue_reminders(current_date)',
    );
    expect(rows.find((row) => row.kind === 'task.due')!.queued).toBeGreaterThanOrEqual(1);
    const again = await worker.query<{ queued: number }>(
      'SELECT queued FROM notify.queue_reminders(current_date)',
    );
    expect(again.rows.map((row) => row.queued)).toEqual([0, 0, 0, 0]);

    const [due] = await arrived('kitchen.a@pythagoras.test', `Due tomorrow: ${title}`);
    expect(await text(due!)).toContain(`is due tomorrow, ${tomorrow}.`);
    const [overdue] = await arrived('principal.a@pythagoras.test', 'overdue task');
    expect(await text(overdue!)).toContain('- Book the stage (synthetic)');
    const [staff] = await arrived('principal.a@pythagoras.test', 'Staff records to see to at School A');
    expect(await text(staff!)).toContain(`/schools/${SCHOOL_A}/staff`);
  }, 45_000);
});
