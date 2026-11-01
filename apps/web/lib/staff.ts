import { CONTRACT_KINDS, type ContractKind, type EmploymentRequestBody } from '@pythagoras/shared';
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
};
