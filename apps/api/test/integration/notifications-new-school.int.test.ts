import {
  type AccountingCompanies,
  type AccountingSummary,
  type AddGuardianResponse,
  type CreatedAccountResponse,
  type SchoolDocuments,
} from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  API,
  finishFirstSignIn,
  get,
  offeringsOf,
  payAndWait,
  placeOrder,
  post,
  secret,
  tokenFor,
} from './helpers';

// M7.6: notifications end to end at a school added through administration,
// with no code, migration or configuration change. The group administrator
// sets up School G with its own company, lunch and principal; the principal
// enrols a child and records a guardian new to the group. The guardian pays
// for lunch and receives the confirmation; the principal's policy waits for
// the principal and then the CEO, each told by e-mail; the daily reminders
// (run as the worker runs them) remind the principal of a task due tomorrow;
// and group finance finds the payment in School G's company export. Test data
// uses the "test-" prefix and is removed before each run. This lives with the
// integration tests because the reminder job is run as the worker, which a
// browser cannot do.

const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const LUNCH = 'd1000000-0000-7000-8000-000000000001';
const run = Date.now().toString(36);
const code = `test-${run}-g`;
const companyName = `Test company ${run} G`;
const today = new Date().toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const tokens: Record<string, string> = {};

/** A Monday at least a week ahead, so lunch can still be booked for it. */
function mondayAhead(): Date {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7 || 7) + 7);
  return date;
}
const plus = (date: Date, days: number) =>
  new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);

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
let schoolId: string;
let companyId: string;
const principalEmail = `test-${run}-g-principal@pythagoras.test`;
const parentEmail = `test-${run}-g-parent@pythagoras.test`;

beforeAll(async () => {
  for (const user of ['admin', 'ceo', 'finance']) tokens[user] = await tokenFor(user);
  worker = new Client({
    host: 'postgres',
    database: 'pythagoras',
    user: 'pyth_worker',
    password: secret('pg_worker_password'),
  });
  await worker.connect();
});
afterAll(() => worker.end());

describe('notifications at a school added through administration', () => {
  it('sets School G up, with a principal and a family new to the group', async () => {
    const admin = tokens['admin']!;
    const company = await post<{ id: string }>(admin, '/admin/billing-entities', {
      legalName: companyName,
      registrationNumber: String(Date.now()).slice(-9),
    });
    expect(company.status).toBe(201);
    companyId = company.body.id;
    const school = await post<{ id: string }>(admin, '/admin/schools', {
      code,
      name: `School G ${run}`,
      kind: 'school',
      timeZone: 'Europe/Sofia',
      billingEntityId: companyId,
    });
    expect(school.status).toBe(201);
    schoolId = school.body.id;
    const lunch = await post<{ offeringId: string }>(admin, `/admin/schools/${schoolId}/offerings`, {
      serviceDefinitionId: LUNCH,
      name: `Lunch at School G ${run}`,
      unitAmountMinor: 560,
      priceUnit: 'per_day',
    });
    const monday = mondayAhead();
    await post(admin, `/admin/schools/${schoolId}/sessions`, {
      offeringId: lunch.body.offeringId,
      capacity: 40,
      schedule: { type: 'school_days', from: plus(monday, 0), to: plus(monday, 4) },
    });
    const head = await post<{ personId: string }>(admin, `/admin/schools/${schoolId}/staff`, {
      givenName: 'Gergana',
      familyName: 'Principal',
      email: principalEmail,
      roleCode: 'principal',
    });
    expect((await post(admin, `/admin/schools/${schoolId}/activate`)).status).toBe(200);
    const account = await post<CreatedAccountResponse>(admin, `/admin/people/${head.body.personId}/account`);
    tokens['principal'] = await finishFirstSignIn(account.body.username, `Principal-${run}-Passw0rd`);

    const child = await post<{ studentId: string }>(tokens['principal'], `/schools/${schoolId}/students`, {
      givenName: 'Galya',
      familyName: 'Newfamily',
      academicYear: '2026/2027',
      gradeLevel: '2',
      classLabel: '2A',
      startDate: '2026-09-15',
    });
    expect(child.status).toBe(201);
    tokens['childId'] = child.body.studentId;
    const guardian = await post<AddGuardianResponse>(
      tokens['principal'],
      `/schools/${schoolId}/students/${child.body.studentId}/guardians`,
      {
        email: parentEmail,
        givenName: 'Gloria',
        familyName: 'Newfamily',
        relationship: 'mother',
        canPay: true,
        canManageBookings: true,
      },
    );
    expect(guardian.body.existing).toBe(false);
    const parentAccount = await post<CreatedAccountResponse>(
      admin,
      `/admin/people/${guardian.body.guardianPersonId}/account`,
    );
    tokens['parent'] = await finishFirstSignIn(parentAccount.body.username, `Parent-${run}-Passw0rd`);
  }, 60_000);

  it('confirms the guardian’s payment, and finance finds it in School G’s company export', async () => {
    const { lunch } = await offeringsOf(tokens['parent']!, tokens['childId']!);
    const placed = await placeOrder(tokens['parent']!, [
      { studentId: tokens['childId']!, offeringId: lunch.id, sessionIds: [lunch.sessions[0]!.id] },
    ]);
    await payAndWait(tokens['parent']!, placed);
    const orderNumber = placed.orders[0]!.orderNumber;
    const [paid] = await arrived(parentEmail, `Payment received: order ${orderNumber}`);
    const body = await text(paid!);
    expect(body).toContain('Dear Gloria Newfamily,');
    expect(body).not.toContain('Galya');

    const companies = (await get<AccountingCompanies>('/accounting/companies', tokens['finance']!)).body
      .companies;
    expect(companies.map((company) => company.id)).toContain(companyId);
    const query = new URLSearchParams({ companyId, from: today, to: today }).toString();
    const summary = (await get<AccountingSummary>(`/accounting/summary?${query}`, tokens['finance']!)).body;
    expect(summary).toMatchObject({ company: { legalName: companyName }, entries: 1 });
    expect(summary.net).toEqual([{ currency: 'EUR', mode: 'test', amountMinor: 560 }]);
    const csv = await (
      await fetch(`${API}/accounting/export?${query}`, {
        headers: { authorization: `Bearer ${tokens['finance']}` },
      })
    ).text();
    expect(csv).toContain(`,payment,test,${orderNumber},${code},School G ${run},lunch,`);
  }, 60_000);

  it('asks School G’s principal, then the CEO, to approve its policy', async () => {
    const title = `School G policy (${run})`;
    const created = await post<{ id: string }>(tokens['principal']!, '/documents', {
      attachedTo: 'school',
      schoolId,
      title,
      category: 'policy',
      forAllStaff: true,
    });
    await fetch(`${API}/documents/${created.body.id}/file`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tokens['principal']}`,
        'content-type': 'application/pdf',
        'x-file-name': 'policy.pdf',
      },
      body: new Uint8Array(Buffer.from('%PDF-1.7\n% School G policy (synthetic)\n')),
    });
    const documents = (await get<SchoolDocuments>(`/schools/${schoolId}/documents`, tokens['principal']!))
      .body;
    const version = documents.documents.find((document) => document.id === created.body.id)!.versions[0]!;
    await post(tokens['principal']!, `/documents/versions/${version.id}/approvals`, {
      steps: ['principal', 'group_ceo'],
    });
    const [first] = await arrived(principalEmail, `Waiting for your approval: ${title}`);
    expect(await text(first!)).toContain(`(School G ${run}) is waiting for your approval, step 1 of 2.`);

    const waiting = await get<{ waiting: { stepId: string; title: string }[] }>(
      '/documents/approvals/waiting',
      tokens['principal']!,
    );
    const step = waiting.body.waiting.find((entry) => entry.title === title)!;
    await post(tokens['principal']!, `/documents/approval-steps/${step.stepId}/decision`, {
      decision: 'approved',
    });
    const [second] = await arrived('ceo@pythagoras.test', `Waiting for your approval: ${title}`);
    expect(await text(second!)).toContain('step 2 of 2');
  }, 60_000);

  it('reminds the principal of a task due tomorrow, from the daily job', async () => {
    const me = (await get<{ person: { id: string } }>('/me', tokens['principal']!)).body.person.id;
    const title = `Book the school photographer (${run})`;
    expect(
      (await post(tokens['principal']!, '/tasks', { title, assigneeId: me, schoolId, dueOn: tomorrow }))
        .status,
    ).toBe(201);
    await worker.query(`SELECT set_config('app.actor', 'worker:reminders-test', false)`);
    const { rows } = await worker.query<{ kind: string; queued: number }>(
      'SELECT * FROM notify.queue_reminders(current_date)',
    );
    expect(rows.find((row) => row.kind === 'task.due')!.queued).toBeGreaterThanOrEqual(1);
    const [due] = await arrived(principalEmail, `Due tomorrow: ${title}`);
    expect(await text(due!)).toContain(`at School G ${run} is due tomorrow, ${tomorrow}.`);
  }, 60_000);
});
