import { describe, expect, it } from 'vitest';
import { checkPayload } from './payload-guard';

describe('checkPayload', () => {
  it.each([
    [{}],
    [{ order_id: 'c1000000-0000-7000-8000-000000000020', status: 'paid', amount_minor: 450 }],
    [{ lines: ['a1000000-0000-7000-8000-000000000001'], retry: false, reason_code: 'card_declined' }],
  ])('accepts identifiers, codes and numbers: %j', (payload) => {
    expect(checkPayload(payload)).toBeNull();
  });

  it.each([
    [{ email: 'anna.ivanova@pythagoras.test' }, 'suggests personal data'],
    [{ given_name: 'Anna' }, 'suggests personal data'],
    [{ parent_phone: '+359888000000' }, 'suggests personal data'],
    [{ cancellation_reason: 'ill' }, 'suggests personal data'],
    [{ reason_code: 'parent said she has the flu' }, 'not an identifier or code'],
    [{ status: 'Anna Ivanova' }, 'not an identifier or code'],
    [{ who: 'anna@example.test' }, 'not an identifier or code'],
    [{ 'Bad Key': 1 }, 'not snake_case'],
    [{ a: { b: { c: { d: 1 } } } }, 'nesting deeper'],
    [{ amount: Number.NaN }, 'non-finite'],
  ])('refuses %j', (payload, reason) => {
    expect(checkPayload(payload)).toContain(reason);
  });
});
