import { describe, expect, it } from 'vitest';
import { stockSchema, variantSchema } from './uniforms.controller';

const id = '01a18e7b-baec-7c6b-a92d-881b1ae3371a';

describe('uniform requests', () => {
  it('takes a variant with a code and a price in cents', () => {
    expect(
      variantSchema.safeParse({ offeringId: id, sku: 'POLO-NAVY-128', size: '128', unitAmountMinor: 2500 })
        .success,
    ).toBe(true);
    expect(variantSchema.safeParse({ offeringId: id, sku: 'has space', unitAmountMinor: 2500 }).success).toBe(
      false,
    );
    expect(variantSchema.safeParse({ offeringId: id, sku: 'X', unitAmountMinor: -1 }).success).toBe(false);
  });

  it('takes a delivery as a positive number and a correction either way, with a reason', () => {
    expect(stockSchema.safeParse({ kind: 'delivery', delta: 10, reason: 'Delivery' }).success).toBe(true);
    expect(stockSchema.safeParse({ kind: 'correction', delta: -2, reason: 'Counted' }).success).toBe(true);
    expect(stockSchema.safeParse({ kind: 'delivery', delta: -2, reason: 'No' }).success).toBe(false);
    expect(stockSchema.safeParse({ kind: 'correction', delta: 0, reason: 'No' }).success).toBe(false);
    expect(stockSchema.safeParse({ kind: 'correction', delta: 1, reason: '' }).success).toBe(false);
  });
});
