import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { permissionBody } from './trips';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });
const fields = {
  agree: 'yes',
  policy_version_id: 'v1',
  contact_name: ' Grandma ',
  contact_phone: '+359 88 123 4567',
};

describe('the trip permission form', () => {
  it('needs the box ticked, a contact name and a phone number', () => {
    expect(permissionBody(form(fields))).toEqual({
      policyVersionId: 'v1',
      agree: true,
      emergencyContactName: 'Grandma',
      emergencyContactPhone: '+359 88 123 4567',
    });
    expect(() => permissionBody(form({ ...fields, agree: '' }))).toThrow(FormProblem);
    expect(() => permissionBody(form({ ...fields, contact_name: '' }))).toThrow(FormProblem);
    expect(() => permissionBody(form({ ...fields, contact_phone: 'later' }))).toThrow(FormProblem);
  });
});
