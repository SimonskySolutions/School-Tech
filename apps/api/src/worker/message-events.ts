import { z } from 'zod';
import { type SystemDatabase } from '../database/system-database';
import { type OutboxJobData } from './outbox-relay';

// Events that tell someone something (M7.2, ADR 0031). Each event carries
// identifiers only; one notify.* function decides who is told and queues
// their messages, once per person and thing, so a repeated event changes nothing.

const uuid = z.uuid();

const HANDLERS = {
  'documents.approval.advanced': {
    payload: z.object({ request_id: uuid }),
    sql: 'SELECT notify.on_approval_advanced($1) AS queued',
    args: (p: { request_id: string }) => [p.request_id],
  },
  'work.task.assigned': {
    payload: z.object({ task_id: uuid, assignee_id: uuid }),
    sql: 'SELECT notify.on_task_assigned($1, $2) AS queued',
    args: (p: { task_id: string; assignee_id: string }) => [p.task_id, p.assignee_id],
  },
  'people.family_request.answered': {
    payload: z.object({ request_id: uuid, message_id: uuid }),
    sql: 'SELECT notify.on_request_answered($1, $2) AS queued',
    args: (p: { request_id: string; message_id: string }) => [p.request_id, p.message_id],
  },
  'scheduling.waiting_entry.place_free': {
    payload: z.object({ entry_id: uuid }),
    sql: 'SELECT notify.on_place_free($1) AS queued',
    args: (p: { entry_id: string }) => [p.entry_id],
  },
  'privacy.consent_wording.renewal': {
    payload: z.object({ wording_id: uuid }),
    sql: 'SELECT notify.on_wording_renewal($1) AS queued',
    args: (p: { wording_id: string }) => [p.wording_id],
  },
  'admissions.inquiry.invited': {
    payload: z.object({ inquiry_id: uuid }),
    sql: 'SELECT notify.on_applicant_invited($1) AS queued',
    args: (p: { inquiry_id: string }) => [p.inquiry_id],
  },
} as const;

export type MessageEvent = keyof typeof HANDLERS;
export const MESSAGE_EVENTS = Object.keys(HANDLERS) as MessageEvent[];

export function messageEventHandler(database: SystemDatabase, eventType: MessageEvent) {
  const handler = HANDLERS[eventType] as {
    payload: z.ZodType;
    sql: string;
    args: (payload: never) => string[];
  };
  return async (event: OutboxJobData): Promise<void> => {
    const payload = handler.payload.parse(event.payload) as never;
    await database.withSystem('worker:message-events', (tx) => tx.query(handler.sql, handler.args(payload)));
  };
}
