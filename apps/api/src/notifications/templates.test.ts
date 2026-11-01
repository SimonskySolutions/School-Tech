import { describe, expect, it } from 'vitest';
import { type SystemDatabase, type SystemTransaction } from '../database/system-database';
import { MESSAGE_EVENTS, messageEventHandler } from '../worker/message-events';
import { preferenceSchema } from './notifications.controller';
import { MESSAGE_KINDS, renderMessage } from './templates';

const ID = '01a19900-0000-7000-8000-000000000001';
const to = { givenName: 'Radka', familyName: 'Mineva' };
const portal = 'https://portal.example.test';

describe('message templates', () => {
  it('cover every kind of message', () => {
    expect(MESSAGE_KINDS.sort()).toEqual(
      [
        'admissions.invited',
        'approval.waiting',
        'consent.asked_again',
        'order.paid',
        'request.answered',
        'task.assigned',
      ].sort(),
    );
  });

  it('tell staff what waits for them and where', () => {
    const approval = renderMessage(
      'approval.waiting',
      { title: 'Safeguarding policy', schoolName: 'School A', versionNo: 2, stepNo: 1, steps: 2 },
      to,
      portal,
    );
    expect(approval.subject).toBe('Waiting for your approval: Safeguarding policy');
    expect(approval.text).toContain(
      'Version 2 of "Safeguarding policy" (School A) is waiting for your approval, step 1 of 2.',
    );
    expect(approval.text).toContain(`${portal}/documents/approvals`);
    const task = renderMessage(
      'task.assigned',
      {
        title: 'Plan the menu',
        dueOn: '2026-11-10',
        projectName: 'Spring fair',
        schoolName: 'School A',
        setBy: 'Petar Nikolov',
      },
      to,
      portal,
    );
    expect(task.text).toContain(
      'Petar Nikolov has given you a task: "Plan the menu", in the project "Spring fair" at School A.',
    );
    expect(task.text).toContain('It is due on 2026-11-10.');
    expect(
      renderMessage(
        'task.assigned',
        { title: 'x', dueOn: null, projectName: null, schoolName: null, setBy: 'P' },
        to,
        portal,
      ).text,
    ).not.toContain('due');
  });

  it('tell families only that something happened, and where to read it', () => {
    const reply = renderMessage('request.answered', { schoolName: 'School A', studentId: ID }, to, portal);
    expect(reply.text).toContain(`${portal}/children/${ID}/requests`);
    const consent = renderMessage(
      'consent.asked_again',
      { purposeName: 'Photos on the website', childGivenName: 'Mila', studentId: ID },
      to,
      portal,
    );
    expect(consent.text).toContain('no longer counts');
    expect(consent.text).toContain(`${portal}/children/${ID}/consents`);
    expect(renderMessage('admissions.invited', { schoolName: 'School A' }, to, portal).text).toContain(
      `${portal}/admissions/apply`,
    );
    expect(() =>
      renderMessage(
        'request.answered',
        { schoolName: 'School A', studentId: ID, subject: 'nuts' },
        to,
        portal,
      ),
    ).toThrow();
  });
});

describe('message events', () => {
  it('each call one function with the event’s identifiers, and refuse anything else', async () => {
    const calls: { sql: string; params: readonly unknown[] }[] = [];
    const database = {
      withSystem: <T>(_actor: string, work: (tx: SystemTransaction) => Promise<T>) =>
        work({
          query: <Row>(sql: string, params: readonly unknown[] = []) => {
            calls.push({ sql, params });
            return Promise.resolve([] as Row[]);
          },
        }),
    } as unknown as SystemDatabase;
    const event = (type: string, payload: Record<string, unknown>) => ({
      eventId: ID,
      groupId: ID,
      eventType: type,
      aggregateType: 'x.y',
      aggregateId: ID,
      payload,
      occurredAt: '2026-11-01T00:00:00Z',
    });
    await messageEventHandler(
      database,
      'work.task.assigned',
    )(event('work.task.assigned', { task_id: ID, assignee_id: ID }));
    expect(calls).toEqual([{ sql: 'SELECT notify.on_task_assigned($1, $2) AS queued', params: [ID, ID] }]);
    await expect(
      messageEventHandler(
        database,
        'documents.approval.advanced',
      )(event('documents.approval.advanced', { request_id: 'x' })),
    ).rejects.toThrow();
    expect(MESSAGE_EVENTS).toHaveLength(5);
  });

  it('let people choose a kind of message by its code', () => {
    expect(preferenceSchema.safeParse({ kind: 'task.assigned', enabled: false }).success).toBe(true);
    expect(preferenceSchema.safeParse({ kind: 'Tasks!', enabled: false }).success).toBe(false);
    expect(preferenceSchema.safeParse({ kind: 'task.assigned' }).success).toBe(false);
  });
});
