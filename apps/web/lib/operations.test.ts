import { describe, expect, it } from 'vitest';
import { budgetUse, expenseBody, itemBody, movementBody } from './operations';

const form = (fields: Record<string, string>) => ({ get: (name: string) => fields[name] ?? null });

describe('budgets', () => {
  it('warns close to the limit and marks going over', () => {
    expect(budgetUse(5000, 10000)).toEqual({ percent: 50, state: 'ok' });
    expect(budgetUse(9000, 10000).state).toBe('warn');
    expect(budgetUse(11000, 10000)).toEqual({ percent: 100, state: 'full' });
  });

  it('counts spending without a budget as over', () => {
    expect(budgetUse(100, 0).state).toBe('warn');
    expect(budgetUse(0, 0)).toEqual({ percent: 0, state: 'ok' });
  });
});

describe('stock forms', () => {
  it('reads an item with no supplier', () => {
    expect(itemBody(form({ kind: 'book', name: 'Maths 3', reorder_level: '5' }))).toEqual({
      kind: 'book',
      name: 'Maths 3',
      reorderLevel: 5,
      supplierId: null,
    });
  });

  it('asks what happened to the stock', () => {
    expect(() => movementBody(form({ reason: 'vanished', quantity: '1' }))).toThrow('choose what happened');
  });
});

describe('expense form', () => {
  it('reads the amount as minor units', () => {
    const body = expenseBody(
      form({ category: 'food', description: 'Trays', amount: '125.50', spent_on: '2026-11-05' }),
    );
    expect(body.amountMinor).toBe(12550);
  });
});
