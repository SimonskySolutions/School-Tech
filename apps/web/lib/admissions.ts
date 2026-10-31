import {
  type AdmissionsPipeline,
  APPLICATION_NOTE_KINDS,
  type EnrolRequestBody,
  GUARDIAN_RELATIONSHIPS,
  type GuardianRelationshipKind,
  type ApplicationNoteKind,
  type ApplicationRequestBody,
  type ApplicationStatus,
  type IntakeRequestBody,
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

// Applications (M5.2, ADR 0027). -------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A parent's application: one of their children (`child` = its id) or a new child (`child` = "new"). */
export function applicationBody(form: Form): ApplicationRequestBody {
  const intakeId = text(form, 'intake_id');
  const noticeId = text(form, 'notice_id');
  if (!UUID.test(intakeId)) throw new FormProblem('choose the school and grade');
  if (!UUID.test(noticeId)) throw new FormProblem('please reload the page and send the form again');
  if (text(form, 'notice_read') !== 'yes')
    throw new FormProblem('please confirm you have read the privacy notice');
  const child = text(form, 'child');
  const extra = {
    ...withValue('currentSchool', optional(form, 'current_school', 200, 'The current school')),
    ...withValue('message', optional(form, 'message', 2000, 'The message')),
  };
  if (UUID.test(child)) return { intakeId, noticeId, studentId: child, ...extra };
  if (child !== 'new') throw new FormProblem('choose the child');
  const givenName = text(form, 'child_given_name');
  const familyName = text(form, 'child_family_name');
  const birthDate = text(form, 'child_birth_date');
  if (!givenName || givenName.length > 100 || !familyName || familyName.length > 100) {
    throw new FormProblem("give the child's first and family name");
  }
  if (!DAY.test(birthDate)) throw new FormProblem("give the child's date of birth");
  return { intakeId, noticeId, child: { givenName, familyName, birthDate }, ...extra };
}

export function intakeBody(form: Form): IntakeRequestBody {
  const schoolId = text(form, 'school_id');
  if (!UUID.test(schoolId)) throw new FormProblem('choose the school');
  const schoolYear = text(form, 'school_year');
  if (!/^\d{4}\/\d{2}$/.test(schoolYear)) throw new FormProblem('give the school year like 2027/28');
  const grade = text(form, 'grade');
  if (!grade || grade.length > 20) throw new FormProblem('give the grade');
  const places = Number(text(form, 'places'));
  if (!Number.isInteger(places) || places < 1 || places > 1000)
    throw new FormProblem('give the number of places');
  const opensOn = text(form, 'opens_on');
  const closesOn = text(form, 'closes_on');
  if (!DAY.test(opensOn) || !DAY.test(closesOn) || closesOn < opensOn) {
    throw new FormProblem('give the dates applications open and close, in that order');
  }
  return { schoolId, schoolYear, grade, places, opensOn, closesOn };
}

/** The parent's name as staff confirm it for an invitation; the form's guess splits at the last space. */
export function inviteBody(form: Form): { givenName: string; familyName: string } {
  const givenName = text(form, 'given_name');
  const familyName = text(form, 'family_name');
  if (!givenName || givenName.length > 100 || !familyName || familyName.length > 100) {
    throw new FormProblem("give the parent's first and family name");
  }
  return { givenName, familyName };
}

export function splitName(name: string | null): { givenName: string; familyName: string } {
  const clean = (name ?? '').replace(/\s*\(.*\)\s*$/, '').trim();
  const at = clean.lastIndexOf(' ');
  return at > 0
    ? { givenName: clean.slice(0, at), familyName: clean.slice(at + 1) }
    : { givenName: clean, familyName: '' };
}

export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: 'Submitted',
  under_review: 'Under review',
  waitlisted: 'On the waiting list',
  offered: 'Place offered',
  accepted: 'Place accepted',
  enrolled: 'Enrolled',
  declined: 'Offer declined',
  expired: 'Offer expired',
  rejected: 'Not offered a place',
  withdrawn: 'Withdrawn',
};

export const APPLICATION_NOTE_LABELS: Record<ApplicationNoteKind, string> = {
  note: 'Note',
  interview: 'Interview',
  assessment: 'Assessment',
};

/** Applications that need nothing more: enrolled, or no longer holding or waiting for a place. */
export const isFinished = (status: ApplicationStatus) =>
  status === 'enrolled' ||
  status === 'withdrawn' ||
  status === 'rejected' ||
  status === 'declined' ||
  status === 'expired';

export const RELATIONSHIP_LABELS: Record<GuardianRelationshipKind, string> = {
  mother: 'Mother',
  father: 'Father',
  parent: 'Parent',
  legal_guardian: 'Legal guardian',
  foster_carer: 'Foster carer',
  other: 'Other',
};

/** The hand-off form: the start date, an optional class, and for a new child the parent's relationship. */
export function enrolBody(form: Form, newChild: boolean): EnrolRequestBody {
  const startDate = text(form, 'start_date');
  if (!DAY.test(startDate)) throw new FormProblem('give the first school day');
  const classLabel = text(form, 'class_label');
  if (classLabel.length > 40) throw new FormProblem('a class has at most 40 characters');
  const relationship = text(form, 'relationship');
  if (newChild && !(GUARDIAN_RELATIONSHIPS as readonly string[]).includes(relationship)) {
    throw new FormProblem('say how the parent is related to the child');
  }
  return {
    startDate,
    ...(classLabel ? { classLabel } : {}),
    ...(newChild ? { relationship: relationship as GuardianRelationshipKind } : {}),
  };
}

/** The day an offer must be answered by. */
export function offerBody(form: Form): { answerBy: string } {
  const answerBy = text(form, 'answer_by');
  if (!DAY.test(answerBy)) throw new FormProblem('give the date the family must answer by');
  return { answerBy };
}

export function applicationNoteBody(form: Form): { kind: ApplicationNoteKind; body: string } {
  const kind = text(form, 'kind');
  if (!(APPLICATION_NOTE_KINDS as readonly string[]).includes(kind))
    throw new FormProblem('choose what kind of note');
  const body = text(form, 'body');
  if (!body) throw new FormProblem('write the note');
  if (body.length > 4000) throw new FormProblem('a note has at most 4000 characters');
  return { kind: kind as ApplicationNoteKind, body };
}

export const APPLICATION_DONE: Record<string, string> = {
  applied: 'Application sent to the school.',
  withdrawn: 'Application withdrawn.',
  reviewed: 'Taken into review.',
  offered: 'Place offered.',
  waitlisted: 'Put on the waiting list.',
  rejected: 'Marked as not offered a place.',
  noted: 'Note added.',
  enrolled: 'Enrolled. The family can now book services for the child.',
  accepted: 'Place accepted. The school will be in touch about the next steps.',
  declined: 'Offer declined.',
  'intake-opened': 'Intake opened.',
  'intake-closed': 'Intake closed.',
};

// The pipeline (M5.5). ------------------------------------------------------

export const FOLLOW_UP_LABELS: Record<NonNullable<AdmissionsPipeline['followUps']>[number]['kind'], string> =
  {
    inquiry_waiting: 'Inquiry not answered',
    application_waiting: 'Application not reviewed',
    offer_ending: 'Offer ending',
    to_enrol: 'Accepted, to enrol',
  };

/** Applications that ended without a place: declined, expired, refused or withdrawn. */
export const notPlaced = (counts: Record<ApplicationStatus, number>) =>
  counts.declined + counts.expired + counts.rejected + counts.withdrawn;
