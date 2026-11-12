import { type ExpenseCategory, type StockKind } from '@pythagoras/shared';
import { amountMinor, type Form, FormProblem, text } from './admin';

// Stock and money forms and labels, as plain functions tested without a browser.
// The API and the database check everything again.

export const STOCK_KINDS: Record<StockKind, string> = {
  book: 'Books',
  equipment: 'Equipment',
  supply: 'Supplies',
};

export const STOCK_REASONS: Record<string, string> = {
  delivered: 'Delivered',
  issued: 'Issued',
  returned: 'Returned',
  lost: 'Lost or damaged',
  counted: 'Counted (a correction)',
};

export const EXPENSE_CATEGORIES: Record<ExpenseCategory, string> = {
  materials: 'Teaching materials',
  food: 'Food',
  utilities: 'Utilities',
  maintenance: 'Maintenance',
  transport: 'Transport',
  events: 'Events',
  marketing: 'Marketing',
  other: 'Other',
};

export const OPERATIONS_NOTICES: Record<string, string> = {
  item: 'Item added.',
  moved: 'Stock updated.',
  supplier: 'Supplier added.',
  expense: 'Expense recorded.',
  budget: 'Budget set.',
  joined: 'On the waiting list. We will write when a place comes free.',
  left: 'Taken off the waiting list.',
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const whole = (form: Form, name: string, problem: string): number => {
  const value = Number(text(form, name));
  if (text(form, name) === '' || !Number.isInteger(value)) throw new FormProblem(problem);
  return value;
};

export function itemBody(form: Form) {
  const kind = text(form, 'kind');
  const name = text(form, 'name');
  if (!(kind in STOCK_KINDS)) throw new FormProblem('choose a kind');
  if (!name || name.length > 160) throw new FormProblem('give the item a name');
  return {
    kind: kind as StockKind,
    name,
    reorderLevel: whole(form, 'reorder_level', 'give the level to reorder at'),
    supplierId: text(form, 'supplier_id') || null,
  };
}

export function movementBody(form: Form) {
  const reason = text(form, 'reason');
  if (!(reason in STOCK_REASONS)) throw new FormProblem('choose what happened');
  return { itemId: text(form, 'item_id'), reason, quantity: whole(form, 'quantity', 'give a whole number') };
}

export function supplierBody(form: Form) {
  const name = text(form, 'name');
  if (!name || name.length > 160) throw new FormProblem('give the supplier a name');
  return { name, email: text(form, 'email') || null, phone: text(form, 'phone') || null };
}

function category(form: Form): ExpenseCategory {
  const value = text(form, 'category');
  if (!(value in EXPENSE_CATEGORIES)) throw new FormProblem('choose a category');
  return value as ExpenseCategory;
}

export function expenseBody(form: Form) {
  const description = text(form, 'description');
  const spentOn = text(form, 'spent_on');
  if (!description || description.length > 300) throw new FormProblem('say what it was for');
  if (!DAY.test(spentOn)) throw new FormProblem('choose the day');
  return {
    category: category(form),
    description,
    supplierId: text(form, 'supplier_id') || null,
    amountMinor: amountMinor(text(form, 'amount')),
    spentOn,
  };
}

export function budgetBody(form: Form) {
  return { category: category(form), amountMinor: amountMinor(text(form, 'amount')) };
}

/** How much of a budget is spent, and whether it is close or over. */
export function budgetUse(spentMinor: number, budgetMinor: number) {
  const percent = budgetMinor > 0 ? Math.round((spentMinor / budgetMinor) * 100) : spentMinor > 0 ? 100 : 0;
  return {
    percent: Math.min(percent, 100),
    state: percent > 100 ? ('full' as const) : percent >= 85 ? ('warn' as const) : ('ok' as const),
  };
}
