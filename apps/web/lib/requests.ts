import { REQUEST_KINDS, type RequestKind, type RequestStatus } from '@pythagoras/shared';
import { type Form, FormProblem, text } from './admin';

// Parent requests in the web app (M4.7): labels and form reading, tested
// without a browser. The API and the database check everything again.

export const KIND_LABELS: Record<RequestKind, string> = {
  absence: 'Absence',
  dietary: 'Dietary change',
  collection: 'Who collects',
  question: 'Question',
  other: 'Other',
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  open: 'Waiting for the school',
  in_progress: 'The school is on it',
  answered: 'Answered',
  closed: 'Closed',
};

export const REQUEST_NOTICES: Record<string, string> = {
  opened: 'Sent to the school.',
  replied: 'Message sent.',
  closed: 'Closed.',
  taken: 'Marked as being worked on.',
};

export function openBody(form: Form) {
  const kind = text(form, 'kind');
  if (!(REQUEST_KINDS as readonly string[]).includes(kind))
    throw new FormProblem('choose what the request is about');
  const subject = text(form, 'subject');
  if (!subject || subject.length > 200) throw new FormProblem('give a short subject, up to 200 characters');
  return { schoolId: text(form, 'school_id'), kind: kind as RequestKind, subject, message: messageOf(form) };
}

export function replyBody(form: Form) {
  return { message: messageOf(form) };
}

function messageOf(form: Form): string {
  const message = text(form, 'message');
  if (!message) throw new FormProblem('write a message');
  if (message.length > 4000) throw new FormProblem('a message has at most 4000 characters');
  return message;
}
