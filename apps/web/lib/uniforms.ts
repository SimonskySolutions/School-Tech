import { type Form, FormProblem, amountMinor, text } from './admin';

// The uniform forms (M4.6, ADR 0025), tested without a browser. The API and
// the database check everything again.

export const UNIFORM_NOTICES: Record<string, string> = {
  variant: 'Variant added with its price. Take in a delivery to put it on sale.',
  stock: 'Stock changed.',
  'handed-over': 'Handed over.',
};

export function variantBody(form: Form) {
  const sku = text(form, 'sku');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(sku)) {
    throw new FormProblem('the code has letters, digits, dots and dashes, up to 40');
  }
  const threshold = text(form, 'low_stock_threshold');
  const size = text(form, 'size');
  const colour = text(form, 'colour');
  return {
    offeringId: text(form, 'offering_id'),
    sku,
    ...(size ? { size } : {}),
    ...(colour ? { colour } : {}),
    unitAmountMinor: amountMinor(text(form, 'price')),
    ...(threshold ? { lowStockThreshold: Number(threshold) } : {}),
  };
}

export function stockBody(form: Form) {
  const kind = text(form, 'kind');
  const delta = Number(text(form, 'delta'));
  const reason = text(form, 'reason');
  if (kind !== 'delivery' && kind !== 'correction')
    throw new FormProblem('choose a delivery or a correction');
  if (!Number.isInteger(delta) || delta === 0) throw new FormProblem('give a whole number of items, not 0');
  if (kind === 'delivery' && delta < 0)
    throw new FormProblem('a delivery adds items; use a correction to remove');
  if (!reason) throw new FormProblem('say why, for example the delivery note or the count');
  return { kind, delta, reason };
}
