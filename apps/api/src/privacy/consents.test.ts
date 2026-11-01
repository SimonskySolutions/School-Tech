import { describe, expect, it } from 'vitest';
import { consentSchema, wordingSchema } from './consents.controller';
import { ConsentRejected, refusalsAsConsents } from './consents.repository';

const ID = '0b1d2c3e-0000-7000-8000-000000000001';

describe('consents', () => {
  it('name the purpose and the exact wording agreed to', () => {
    expect(consentSchema.safeParse({ purposeId: ID, wordingId: ID }).success).toBe(true);
    expect(consentSchema.safeParse({ purposeId: ID }).success).toBe(false);
    expect(consentSchema.safeParse({ purposeId: ID, wordingId: ID, channel: 'paper' }).success).toBe(false);
  });

  it('are worded with enough to agree to, and say whether families are asked again', () => {
    expect(
      wordingSchema.safeParse({ wording: 'We may publish photos of your child.', renewalRequired: true })
        .success,
    ).toBe(true);
    expect(wordingSchema.safeParse({ wording: 'Photos.', renewalRequired: false }).success).toBe(false);
    expect(wordingSchema.safeParse({ wording: 'We may publish photos of your child.' }).success).toBe(false);
  });

  it('pass on what the database says to do when the wording has changed', async () => {
    const changed = Object.assign(new Error('the wording has changed: read the current wording'), {
      code: 'PY001',
    });
    await expect(refusalsAsConsents(() => Promise.reject(changed))).rejects.toEqual(
      new ConsentRejected(409, 'the wording has changed: read the current wording'),
    );
    const missing = Object.assign(new Error('only a guardian who may consent for the child'), {
      code: 'P0002',
    });
    await expect(refusalsAsConsents(() => Promise.reject(missing))).rejects.toMatchObject({ status: 404 });
  });
});
