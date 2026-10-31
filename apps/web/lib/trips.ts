import { type GiveTripPermissionRequest } from '@pythagoras/shared';
import { type Form, FormProblem, text } from './admin';

// The trip permission form and notices (M4.4, ADR 0023), tested without a
// browser. The API and the database check everything again.

export const TRIP_NOTICES: Record<string, string> = {
  given: 'Permission given. You can now book the place.',
  withdrawn: 'Permission withdrawn.',
  withdrawn_and_cancelled:
    'Permission withdrawn and the place cancelled. What you paid becomes credit within a minute.',
};

const PHONE = /^\+?[0-9 ()-]{6,25}$/;

export function permissionBody(form: Form): GiveTripPermissionRequest {
  if (text(form, 'agree') !== 'yes')
    throw new FormProblem('tick that you have read the wording and give permission');
  const emergencyContactName = text(form, 'contact_name');
  const emergencyContactPhone = text(form, 'contact_phone');
  if (!emergencyContactName || emergencyContactName.length > 120) {
    throw new FormProblem('give the name of the emergency contact');
  }
  if (!PHONE.test(emergencyContactPhone))
    throw new FormProblem('give a phone number such as +359 88 123 4567');
  return {
    policyVersionId: text(form, 'policy_version_id'),
    agree: true,
    emergencyContactName,
    emergencyContactPhone,
  };
}
