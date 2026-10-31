import { describe, expect, it } from 'vitest';
import { permissionSchema, recordSchema, wordingSchema } from './trips.controller';

const id = '01a18e7b-baec-7c6b-a92d-881b1ae3371a';
const permission = {
  policyVersionId: id,
  agree: true,
  emergencyContactName: 'Grandma',
  emergencyContactPhone: '+359 88 123 4567',
};

describe('trip permission requests', () => {
  it('needs the guardian to agree to the wording, and a contact with a phone number', () => {
    expect(permissionSchema.safeParse(permission).success).toBe(true);
    expect(permissionSchema.safeParse({ ...permission, agree: false }).success).toBe(false);
    expect(permissionSchema.safeParse({ ...permission, emergencyContactPhone: 'call me' }).success).toBe(
      false,
    );
    expect(permissionSchema.safeParse({ ...permission, emergencyContactName: ' ' }).success).toBe(false);
  });

  it('lets staff record a permission given on paper or in person only', () => {
    const recorded = { ...permission, studentId: id, guardianPersonId: id, channel: 'paper' };
    expect(recordSchema.safeParse(recorded).success).toBe(true);
    expect(recordSchema.safeParse({ ...recorded, channel: 'family_portal' }).success).toBe(false);
  });

  it('takes consent wording of 10 to 5000 characters', () => {
    expect(wordingSchema.safeParse({ text: 'I agree to the museum visit.' }).success).toBe(true);
    expect(wordingSchema.safeParse({ text: 'ok' }).success).toBe(false);
  });
});
