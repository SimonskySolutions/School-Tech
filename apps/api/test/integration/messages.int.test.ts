import { type MyNotifications, type SchoolDocuments, type StudentConsents } from '@pythagoras/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { API, get, invitedParent, MILA, post, tokenFor } from './helpers';

// Messages for staff and families (M7.2, ADR 0031) against the real stack, as
// they arrive in the development mailbox (Mailpit): a task, an approval step
// by step, a reply from the school, consent asked again and an invitation to
// apply; and a kind turned off is not sent.

const MAILPIT = process.env.MAILPIT_URL ?? 'http://mailpit:8025';
const SCHOOL_A = 'b1000000-0000-7000-8000-00000000000a';
const KITCHEN_A = 'c1000000-0000-7000-8000-000000000009';
const run = Date.now().toString(36);
const tokens: Record<string, string> = {};

interface Mail {
  ID: string;
  Subject: string;
}

const search = async (query: string): Promise<Mail[]> =>
  (
    (await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`)).json()) as {
      messages: Mail[];
    }
  ).messages;
async function arrived(to: string, subject: string): Promise<Mail[]> {
  const deadline = Date.now() + 15_000;
  for (;;) {
    const found = await search(`to:"${to}" subject:"${subject}"`);
    if (found.length > 0 || Date.now() > deadline) return found;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
const text = async (mail: Mail) =>
  ((await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as { Text: string }).Text;

beforeAll(async () => {
  for (const user of ['principal.a', 'kitchen.a', 'anna.ivanova', 'ceo', 'dpo'])
    tokens[user] = await tokenFor(user);
});

describe('messages for staff and families', () => {
  it('tell the kitchen of a task, unless it turned task messages off', async () => {
    const kinds = (await get<MyNotifications>('/notifications', tokens['kitchen.a']!)).body.kinds;
    expect(kinds.map((kind) => kind.code).sort()).toEqual(
      [
        'admissions.invited',
        'approval.waiting',
        'consent.asked_again',
        'offer.expiring',
        'order.paid',
        'request.answered',
        'staff.renewals',
        'task.assigned',
        'task.due',
        'task.overdue',
        'waitlist.place_free',
      ].sort(),
    );
    const title = `Count the plates (${run})`;
    await post(tokens['principal.a']!, '/tasks', { title, assigneeId: KITCHEN_A, schoolId: SCHOOL_A });
    const [mail] = await arrived('kitchen.a@pythagoras.test', title);
    expect(await text(mail!)).toContain(`Petar Nikolov has given you a task: "${title}" at School A.`);

    expect(
      (await post(tokens['kitchen.a']!, '/notifications/preferences', { kind: 'order.paid', enabled: false }))
        .status,
    ).toBe(422);
    expect(
      (
        await post(tokens['kitchen.a']!, '/notifications/preferences', {
          kind: 'task.assigned',
          enabled: false,
        })
      ).status,
    ).toBe(200);
    const quiet = `Wipe the tables (${run})`;
    await post(tokens['principal.a']!, '/tasks', { title: quiet, assigneeId: KITCHEN_A, schoolId: SCHOOL_A });
    await new Promise((resolve) => setTimeout(resolve, 8_000));
    expect(await search(`subject:"${quiet}"`)).toEqual([]);
    const mine = (await get<MyNotifications>('/notifications', tokens['kitchen.a']!)).body;
    expect(mine.kinds.find((kind) => kind.code === 'task.assigned')!.enabled).toBe(false);
    expect(mine.recent.map((message) => message.status)).toEqual(expect.arrayContaining(['sent', 'skipped']));
    await post(tokens['kitchen.a']!, '/notifications/preferences', { kind: 'task.assigned', enabled: true });
  }, 45_000);

  it('ask the principal, then the CEO, to approve a document', async () => {
    const title = `Visitors policy (${run})`;
    const created = await post<{ id: string }>(tokens['principal.a']!, '/documents', {
      attachedTo: 'school',
      schoolId: SCHOOL_A,
      title,
      category: 'policy',
    });
    await fetch(`${API}/documents/${created.body.id}/file`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${tokens['principal.a']}`,
        'content-type': 'application/pdf',
        'x-file-name': 'v.pdf',
      },
      body: new Uint8Array(Buffer.from('%PDF-1.7\n% synthetic\n')),
    });
    const documents = (await get<SchoolDocuments>(`/schools/${SCHOOL_A}/documents`, tokens['principal.a']!))
      .body;
    const version = documents.documents.find((document) => document.id === created.body.id)!.versions[0]!;
    await post(tokens['principal.a']!, `/documents/versions/${version.id}/approvals`, {
      steps: ['principal', 'group_ceo'],
    });
    const [first] = await arrived('principal.a@pythagoras.test', title);
    expect(await text(first!)).toContain('step 1 of 2');
    expect(await search(`to:"ceo@pythagoras.test" subject:"${title}"`)).toEqual([]);

    const waiting = await get<{ waiting: { stepId: string; title: string }[] }>(
      '/documents/approvals/waiting',
      tokens['principal.a']!,
    );
    const step = waiting.body.waiting.find((entry) => entry.title === title)!;
    await post(tokens['principal.a']!, `/documents/approval-steps/${step.stepId}/decision`, {
      decision: 'approved',
    });
    const [second] = await arrived('ceo@pythagoras.test', title);
    expect(await text(second!)).toContain('step 2 of 2');
  }, 45_000);

  it('tell a parent the school replied, without the subject or the reply', async () => {
    const subject = `Collection on Friday (${run})`;
    const opened = await post<{ requestId: string }>(tokens['anna.ivanova']!, `/students/${MILA}/requests`, {
      schoolId: SCHOOL_A,
      kind: 'collection',
      subject,
      message: 'Her grandmother collects her this Friday.',
    });
    await post(tokens['principal.a']!, `/school-life/requests/${opened.body.requestId}/messages`, {
      message: `Noted for Friday (${run}).`,
    });
    const found = await arrived('anna.ivanova@pythagoras.test', 'School A has replied to your message');
    const bodies = await Promise.all(found.map(text));
    expect(bodies.some((body) => body.includes(`/children/${MILA}/requests`))).toBe(true);
    expect(bodies.join('\n')).not.toContain(run);
  }, 45_000);

  it('ask a parent again when consent wording changes in substance', async () => {
    // Recordings, not the seeded website photos other tests read; the consent is withdrawn again at the end.
    const mila = (await get<StudentConsents>(`/students/${MILA}/consents`, tokens['anna.ivanova']!)).body;
    const recordings = mila.consents.find((consent) => consent.code === 'recordings.events')!;
    expect(
      (
        await post(tokens['anna.ivanova']!, `/students/${MILA}/consents`, {
          purposeId: recordings.purposeId,
          wordingId: recordings.wording.id,
        })
      ).status,
    ).toBe(201);
    await post(tokens['dpo']!, `/privacy/consent-purposes/${recordings.purposeId}/wordings`, {
      wording: `The school may record performances and share them with the whole school (${run}).`,
      renewalRequired: true,
    });
    const [mail] = await arrived(
      'anna.ivanova@pythagoras.test',
      'Your consent is asked again: Recordings of performances',
    );
    const body = await text(mail!);
    expect(body).toContain('for Mila no longer counts');
    expect(body).toContain(`/children/${MILA}/consents`);
    await post(tokens['anna.ivanova']!, `/students/${MILA}/consents/${recordings.purposeId}/withdraw`);
  }, 45_000);

  it('invite a family to apply', async () => {
    const { email } = await invitedParent(tokens['principal.a']!, `msg${run}`);
    const [mail] = await arrived(email, 'School A invites you to apply');
    expect(await text(mail!)).toContain('/admissions/apply');
  }, 45_000);
});
