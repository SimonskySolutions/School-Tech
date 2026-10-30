import { parseMoney } from '@pythagoras/shared';

// The school set-up pages' rules (M3.4), as plain functions so they can be
// tested without a browser. Every form posts to /admin/actions, which turns
// the form into one API request with these functions and sends the
// administrator back to the page with a short notice.

export type Form = { get(name: string): FormDataEntryValue | null };

export const text = (form: Form, name: string): string => {
  const value = form.get(name);
  return typeof value === 'string' ? value.trim() : '';
};

const optional = (form: Form, name: string) => text(form, name) || undefined;

export class FormProblem extends Error {}

/** An amount typed in euros ("5.20", "5,2") as minor units. */
export function amountMinor(input: string): number {
  try {
    return parseMoney(input);
  } catch {
    throw new FormProblem(`"${input}" is not an amount, for example 5.20`);
  }
}

/** Dates typed one per line or separated by commas or spaces. */
export function dateList(input: string): string[] {
  const dates = input.split(/[\s,;]+/).filter(Boolean);
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new FormProblem(`"${date}" is not a date (YYYY-MM-DD)`);
  }
  return dates;
}

export function companyBody(form: Form) {
  return {
    legalName: text(form, 'legal_name'),
    registrationNumber: text(form, 'registration_number'),
    vatNumber: optional(form, 'vat_number'),
  };
}

export function schoolBody(form: Form) {
  return {
    code: text(form, 'code').toLowerCase(),
    name: text(form, 'name'),
    kind: text(form, 'kind') || 'school',
    timeZone: text(form, 'time_zone') || 'Europe/Sofia',
    billingEntityId: text(form, 'billing_entity_id'),
  };
}

export function offeringBody(form: Form) {
  return {
    serviceDefinitionId: text(form, 'service_definition_id'),
    name: text(form, 'name'),
    unitAmountMinor: amountMinor(text(form, 'price')),
    priceUnit: text(form, 'price_unit'),
  };
}

export function sessionsBody(form: Form) {
  const capacity = Number(text(form, 'capacity'));
  const closed = dateList(text(form, 'closed'));
  const common = { from: text(form, 'from'), to: text(form, 'to'), ...(closed.length ? { closed } : {}) };
  return {
    offeringId: text(form, 'offering_id'),
    capacity,
    location: optional(form, 'location'),
    schedule:
      text(form, 'pattern') === 'weekly'
        ? {
            type: 'weekly',
            weekday: Number(text(form, 'weekday')),
            startTime: text(form, 'start_time'),
            endTime: text(form, 'end_time'),
            ...common,
          }
        : { type: 'school_days', ...common },
  };
}

export function staffBody(form: Form) {
  return {
    givenName: text(form, 'given_name'),
    familyName: text(form, 'family_name'),
    email: text(form, 'email').toLowerCase(),
    roleCode: text(form, 'role_code'),
  };
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const PRICE_UNITS: Record<string, string> = {
  per_day: 'per day',
  per_session: 'per session',
  per_month: 'per month',
  per_term: 'per term',
  one_off: 'one-off',
};

export const ROLE_CHOICES: Record<string, string> = {
  principal: 'Principal',
  school_admin: 'School administrator',
  teacher: 'Teacher',
  kitchen: 'Kitchen',
};

/** Short notices after a successful action, by action name. */
export const DONE: Record<string, string> = {
  'create-company': 'Company added.',
  'create-school': 'School created as a draft. Add offerings, calendars and a principal, then activate it.',
  'add-offering': 'Offering added with its first price.',
  'add-sessions': 'Calendar added.',
  'add-staff': 'Staff member registered. Create their sign-in account when they are ready.',
  activate: 'The school is live: parents and staff can now see it, and so is its website.',
  'create-website': 'Website created. Editors can add its pages in the CMS.',
};

/** The address to go back to, never anywhere outside the set-up pages. */
export function backTo(path: string, outcome: { done?: string; error?: string; extra?: string }): string {
  const safe = /^\/admin\/schools(\/[0-9a-f-]{36})?$/.test(path) ? path : '/admin/schools';
  const query = new URLSearchParams();
  if (outcome.done) query.set('done', outcome.done);
  if (outcome.error) query.set('error', outcome.error.slice(0, 300));
  if (outcome.extra) query.set('extra', outcome.extra);
  return `${safe}?${query}`;
}
