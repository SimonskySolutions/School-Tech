import { type ConsentState, type WordingRequestBody } from '@pythagoras/shared';
import { FormProblem, text } from './admin';

// Consent from families (M6.6, ADR 0030): labels, notices and the wording
// form. The API and the database check everything again.

type Form = Pick<FormData, 'get'>;

/** What staff read in the photo list. */
export const STATE_LABELS: Record<ConsentState, string> = {
  given: 'Yes',
  none: 'No',
  renewal: 'No: asked again',
};

export const CONSENT_NOTICES: Record<string, string> = {
  given: 'Thank you. Your consent is recorded with the wording you agreed to.',
  withdrawn: 'Your consent is withdrawn. It no longer counts from now on.',
  published: 'The new wording is published.',
};

/** The data protection officer's new wording. */
export function wordingBody(form: Form): WordingRequestBody {
  const wording = text(form, 'wording');
  if (wording.length < 20) throw new FormProblem('write the wording in full (at least 20 characters)');
  if (wording.length > 4000) throw new FormProblem('the wording is at most 4000 characters');
  return { wording, renewalRequired: text(form, 'renewal_required') === 'yes' };
}
