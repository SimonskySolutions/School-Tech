import {
  INQUIRY_NOTE_KINDS,
  INQUIRY_OUTCOMES,
  type InquiryNoteKind,
  type InquiryOutcome,
  type InquiryRequestBody,
  type InquiryStatus,
} from '@pythagoras/shared';
import { type Form, FormProblem, text } from './admin';

// Admissions in the web app (M5.1, ADR 0026): reading the website's inquiry
// form and the staff forms, and their labels, tested without a browser. The
// API and the database check everything again.

/** A field people leave empty; bots fill it. Hidden from people and screen readers. */
export const TRAP_FIELD = 'website';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE = /^\+?[0-9 ()-]{6,20}$/;

const optional = (form: Form, name: string, max: number, label: string): string | undefined => {
  const value = text(form, name);
  if (!value) return undefined;
  if (value.length > max) throw new FormProblem(`${label} has at most ${max} characters`);
  return value;
};

/** True when the hidden field was filled: drop the form, but answer as if it was sent. */
export const isTrapped = (form: Form) => text(form, TRAP_FIELD) !== '';

/** The inquiry the website form describes, for the website at `host`. */
export function inquiryBody(form: Form, host: string): InquiryRequestBody {
  const schoolId = text(form, 'school_id');
  const noticeId = text(form, 'notice_id');
  if (!UUID.test(schoolId)) throw new FormProblem('choose the school');
  if (!UUID.test(noticeId)) throw new FormProblem('please reload the page and send the form again');
  const parentName = text(form, 'parent_name');
  if (!parentName || parentName.length > 200) throw new FormProblem('give your name');
  const email = text(form, 'email').toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) throw new FormProblem('give an e-mail address we can answer');
  const phone = text(form, 'phone');
  if (phone && !PHONE.test(phone))
    throw new FormProblem('give the telephone number in digits, or leave it empty');
  const year = text(form, 'birth_year');
  const birthYear = year ? Number(year) : undefined;
  if (birthYear !== undefined && !(Number.isInteger(birthYear) && birthYear >= 2000 && birthYear <= 2100)) {
    throw new FormProblem('give the year of birth as four digits, or leave it empty');
  }
  if (text(form, 'notice_read') !== 'yes')
    throw new FormProblem('please confirm you have read the privacy notice');
  return {
    host,
    schoolId,
    noticeId,
    parentName,
    email,
    ...(phone ? { phone } : {}),
    ...withValue('childName', optional(form, 'child_name', 100, "The child's first name")),
    ...(birthYear !== undefined ? { birthYear } : {}),
    ...withValue('gradeOfInterest', optional(form, 'grade', 20, 'The grade')),
    ...withValue('intendedStart', optional(form, 'intended_start', 40, 'The start')),
    ...withValue('message', optional(form, 'message', 2000, 'The message')),
    newsConsent: text(form, 'news_consent') === 'yes',
  };
}

const withValue = <K extends string>(key: K, value: string | undefined) =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, string>>;

/** The note staff add to an inquiry. */
export function noteBody(form: Form): { kind: InquiryNoteKind; body: string } {
  const kind = text(form, 'kind');
  if (!(INQUIRY_NOTE_KINDS as readonly string[]).includes(kind))
    throw new FormProblem('choose what kind of note');
  const body = text(form, 'body');
  if (!body) throw new FormProblem('write the note');
  if (body.length > 2000) throw new FormProblem('a note has at most 2000 characters');
  return { kind: kind as InquiryNoteKind, body };
}

export function closeBody(form: Form): { outcome: InquiryOutcome } {
  const outcome = text(form, 'outcome');
  if (!(INQUIRY_OUTCOMES as readonly string[]).includes(outcome)) throw new FormProblem('choose the outcome');
  return { outcome: outcome as InquiryOutcome };
}

/** What the website says after the form: never whether the address was known (ADR 0026). */
export function sentNotice(status: number): 'sent' | 'notice-changed' | 'busy' | 'failed' {
  if (status === 202) return 'sent';
  if (status === 409) return 'notice-changed';
  if (status === 429) return 'busy';
  return 'failed';
}

export const SENT_NOTICES: Record<ReturnType<typeof sentNotice>, string> = {
  sent: 'Thank you. The school has your inquiry and will answer by e-mail.',
  'notice-changed': 'The privacy notice has just changed. Please read it below and send the form again.',
  busy: 'The school is receiving many inquiries just now. Please try again in an hour.',
  failed: 'The inquiry could not be sent. Please try again later.',
};

export const STATUS_LABELS: Record<InquiryStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  closed: 'Closed',
};

export const OUTCOME_LABELS: Record<InquiryOutcome, string> = {
  applied: 'Applied',
  not_interested: 'Not interested',
  no_response: 'No response',
  not_eligible: 'Not eligible',
  duplicate: 'Duplicate',
};

export const NOTE_LABELS: Record<InquiryNoteKind | 'family_message', string> = {
  note: 'Note',
  call: 'Call',
  email: 'E-mail',
  meeting: 'Meeting',
  family_message: 'The family wrote again',
};

export const INQUIRY_DONE: Record<string, string> = {
  noted: 'Note added.',
  closed: 'Inquiry closed.',
};
