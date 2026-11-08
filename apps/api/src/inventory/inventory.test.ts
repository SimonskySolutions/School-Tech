import { describe, expect, it } from 'vitest';
import { movementSchema, stockChange } from './inventory.controller';

const itemId = '019a0000-0000-7000-8000-000000000001';

describe('stock movements', () => {
  it('adds deliveries and returns, and takes away what leaves', () => {
    expect(stockChange('delivered', 10)).toBe(10);
    expect(stockChange('returned', 2)).toBe(2);
    expect(stockChange('issued', 3)).toBe(-3);
    expect(stockChange('lost', 1)).toBe(-1);
  });

  it('lets only a count be negative', () => {
    expect(movementSchema.safeParse({ itemId, reason: 'counted', quantity: -4 }).success).toBe(true);
    expect(movementSchema.safeParse({ itemId, reason: 'issued', quantity: -4 }).success).toBe(false);
    expect(movementSchema.safeParse({ itemId, reason: 'counted', quantity: 0 }).success).toBe(false);
  });
});
