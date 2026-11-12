import { describe, expect, it } from 'vitest';
import { FormProblem } from './admin';
import { stockBody, variantBody } from './uniforms';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('uniform forms', () => {
  it('reads a variant with its price in euros', () => {
    expect(
      variantBody(
        form({ offering_id: 'polo', sku: 'POLO-NAVY-164', size: '164', colour: 'Navy', price: '30,00' }),
      ),
    ).toEqual({
      offeringId: 'polo',
      sku: 'POLO-NAVY-164',
      size: '164',
      colour: 'Navy',
      unitAmountMinor: 3000,
    });
    expect(() => variantBody(form({ sku: 'has space', price: '1' }))).toThrow(FormProblem);
  });

  it('reads a delivery or a correction with a reason', () => {
    expect(stockBody(form({ kind: 'delivery', delta: '12', reason: 'Note 4411' }))).toEqual({
      kind: 'delivery',
      delta: 12,
      reason: 'Note 4411',
    });
    expect(stockBody(form({ kind: 'correction', delta: '-2', reason: 'Counted' })).delta).toBe(-2);
    expect(() => stockBody(form({ kind: 'delivery', delta: '-2', reason: 'x' }))).toThrow(FormProblem);
    expect(() => stockBody(form({ kind: 'correction', delta: '0', reason: 'x' }))).toThrow(FormProblem);
    expect(() => stockBody(form({ kind: 'correction', delta: '1', reason: '' }))).toThrow(FormProblem);
  });
});
