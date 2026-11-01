import {
  CONTRACT_KINDS,
  type ContractKind,
  type EmploymentRequestBody,
  type ExpiryState,
  QUALIFICATION_KINDS,
  type QualificationKind,
  type StaffAttention,
  TRAINING_KINDS,
  type TrainingKind,
  type TrainingRequestBody,
  type TrainingStatus,
} from '@pythagoras/shared';
import { type Form, FormProblem, text } from './admin';

// Staff records in the web app (M6.1, ADR 0028): reading the employment form
// and its labels, tested without a browser. The API and the database check
// everything again.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const CONTRACT_LABELS: Record<ContractKind, string> = {
  permanent: 'Permanent',
  fixed_term: 'Fixed term',
  temporary: 'Temporary',
};

export const ROLE_LABELS: Record<string, string> = {
  principal: 'Principal',
  school_admin: 'School administrator',
  teacher: 'Teacher',
  kitchen: 'Kitchen',
};

/** "Full time", or the share of full time as a percentage. */
export const workingTimeLabel = (workingTime: number) =>
  workingTime >= 1 ? 'full time' : `${Math.round(workingTime * 100)}% of full time`;

/** The employment form; working time is typed as a percentage of full time. */
export function employmentBody(form: Form): EmploymentRequestBody {
  const personId = text(form, 'person_id');
  const employerId = text(form, 'employer_id');
  if (!UUID.test(personId)) throw new FormProblem('choose the member of staff');
  if (!UUID.test(employerId)) throw new FormProblem('choose the employer');
  const position = text(form, 'position');
  if (!position || position.length > 100) throw new FormProblem('give the position');
  const contractKind = text(form, 'contract_kind');
  if (!(CONTRACT_KINDS as readonly string[]).includes(contractKind))
    throw new FormProblem('choose the contract');
  const percent = Number(text(form, 'working_time'));
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new FormProblem('give the working time as a percentage of full time, 1 to 100');
  }
  const startDate = text(form, 'start_date');
  const endDate = text(form, 'end_date');
  if (!DAY.test(startDate)) throw new FormProblem('give the start date');
  if (endDate && (!DAY.test(endDate) || endDate < startDate))
    throw new FormProblem('the end date comes after the start');
  if (contractKind === 'fixed_term' && !endDate)
    throw new FormProblem('a fixed-term contract needs its end date');
  const workEmail = text(form, 'work_email').toLowerCase();
  const workPhone = text(form, 'work_phone').replace(/\s+/g, '');
  return {
    personId,
    employerId,
    position,
    contractKind: contractKind as ContractKind,
    workingTime: percent / 100,
    startDate,
    ...(endDate ? { endDate } : {}),
    ...(workEmail ? { workEmail } : {}),
    ...(workPhone ? { workPhone } : {}),
  };
}

export const STAFF_DONE: Record<string, string> = {
  recorded: 'Employment recorded.',
  ended: 'End date set.',
  qualified: 'Qualification recorded.',
  withdrawn: 'Qualification withdrawn.',
  checked: 'Record check noted.',
  trained: 'Training recorded.',
  attended: 'Marked as attended.',
  cancelled: 'Marked as cancelled.',
};

// Professional development (M6.3). ------------------------------------------

export const TRAINING_LABELS: Record<TrainingKind, string> = {
  course: 'Course',
  conference: 'Conference',
  workshop: 'Workshop',
  in_school: 'In school',
  online: 'Online',
  other: 'Other',
};

export const TRAINING_STATUS_LABELS: Record<TrainingStatus, string> = {
  planned: 'planned',
  attended: 'attended',
  cancelled: 'cancelled',
};

/** "8 h" or "2.5 h". */
export const hoursLabel = (hours: number) => `${hours.toLocaleString('en-GB')} h`;

/** The school year before or after "2026/27". */
export function shiftSchoolYear(year: string, by: -1 | 1): string {
  const start = Number(year.slice(0, 4)) + by;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

export const readSchoolYear = (value: unknown) =>
  typeof value === 'string' && /^\d{4}\/\d{2}$/.test(value) ? value : null;

/** Training in half hours, planned or attended. */
export function trainingBody(form: Form): TrainingRequestBody {
  const title = text(form, 'title');
  if (!title || title.length > 200) throw new FormProblem('give the title');
  const kind = text(form, 'kind');
  if (!(TRAINING_KINDS as readonly string[]).includes(kind)) throw new FormProblem('choose the kind');
  const startsOn = text(form, 'starts_on');
  const endsOn = text(form, 'ends_on') || startsOn;
  if (!DAY.test(startsOn) || !DAY.test(endsOn) || endsOn < startsOn) {
    throw new FormProblem('give the days it starts and ends, in that order');
  }
  const hours = Number(text(form, 'hours').replace(',', '.'));
  if (!(hours > 0 && hours <= 500 && Number.isInteger(hours * 2))) {
    throw new FormProblem('give the hours, in half hours, up to 500');
  }
  const status = text(form, 'status') === 'attended' ? 'attended' : 'planned';
  const provider = text(form, 'provider');
  return {
    title,
    ...(provider ? { provider: provider.slice(0, 200) } : {}),
    kind: kind as TrainingKind,
    startsOn,
    endsOn,
    hours,
    status,
  };
}

// Qualifications and checks (M6.2). -----------------------------------------

export const QUALIFICATION_LABELS: Record<QualificationKind, string> = {
  teaching_licence: 'Teaching licence',
  degree: 'Degree',
  first_aid: 'First aid',
  food_hygiene: 'Food hygiene',
  safeguarding: 'Safeguarding',
  other: 'Other',
};

export const STATE_LABELS: Record<ExpiryState, string> = {
  valid: 'valid',
  expiring: 'ends within 60 days',
  expired: 'expired',
};

export const ATTENTION_LABELS: Record<StaffAttention, string> = {
  check_missing: 'No criminal record check',
  check_expiring: 'Record check ends within 60 days',
  check_expired: 'Record check expired',
  licence_missing: 'No valid teaching licence',
  qualification_expiring: 'A qualification ends within 60 days',
  qualification_expired: 'A qualification has expired',
};

export function qualificationBody(form: Form) {
  const kind = text(form, 'kind');
  if (!(QUALIFICATION_KINDS as readonly string[]).includes(kind)) throw new FormProblem('choose the kind');
  const title = text(form, 'title');
  if (!title || title.length > 200) throw new FormProblem('give the title');
  const issuer = text(form, 'issuer');
  const awardedOn = text(form, 'awarded_on');
  const expiresOn = text(form, 'expires_on');
  if (!DAY.test(awardedOn)) throw new FormProblem('give the day it was awarded');
  if (expiresOn && (!DAY.test(expiresOn) || expiresOn <= awardedOn)) {
    throw new FormProblem('the expiry comes after the award');
  }
  return {
    kind: kind as QualificationKind,
    title,
    ...(issuer ? { issuer: issuer.slice(0, 200) } : {}),
    awardedOn,
    ...(expiresOn ? { expiresOn } : {}),
  };
}

/** Only the dates: the certificate itself is never typed or kept (Art. 10). */
export function checkBody(form: Form): { seenOn: string; validUntil: string } {
  const seenOn = text(form, 'seen_on');
  const validUntil = text(form, 'valid_until');
  if (!DAY.test(seenOn) || !DAY.test(validUntil) || validUntil <= seenOn) {
    throw new FormProblem('give the day the certificate was seen and the day it is valid until');
  }
  return { seenOn, validUntil };
}
