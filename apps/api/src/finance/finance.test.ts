import { describe, expect, it } from 'vitest';
import { budgetSchema, expenseSchema, yearRange } from './finance.controller';

describe('the school year in money', () => {
  it('runs from August to August', () => {
    expect(yearRange('2026/2027')).toEqual({ from: '2026-08-01', to: '2027-08-01' });
  });
});

describe('expenses and budgets', () => {
  const expense = {
    category: 'food',
    description: 'Lunch trays',
    supplierId: null,
    amountMinor: 12500,
    spentOn: '2026-11-05',
  };

  it('takes an expense in a known category', () => {
    expect(expenseSchema.safeParse(expense).success).toBe(true);
    expect(expenseSchema.safeParse({ ...expense, category: 'salaries' }).success).toBe(false);
  });

  it('refuses nothing spent', () => {
    expect(expenseSchema.safeParse({ ...expense, amountMinor: 0 }).success).toBe(false);
    expect(budgetSchema.safeParse({ category: 'food', amountMinor: 0 }).success).toBe(false);
  });
});
