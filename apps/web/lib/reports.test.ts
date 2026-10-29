import { describe, expect, it } from 'vitest';
import { money, readPeriod } from './reports';

describe('readPeriod', () => {
  it('uses the default month when no period is given', () => {
    expect(readPeriod({})).toEqual({ period: null, invalid: false });
  });

  it('accepts a valid period', () => {
    expect(readPeriod({ from: '2026-10-01', to: '2026-10-31' })).toEqual({
      period: { from: '2026-10-01', to: '2026-10-31' },
      invalid: false,
    });
  });

  it('flags half-given, reversed, malformed or over-long periods', () => {
    for (const params of [
      { from: '2026-10-01' },
      { from: '2026-10-31', to: '2026-10-01' },
      { from: '01.10.2026', to: '2026-10-31' },
      { from: '2025-01-01', to: '2026-12-31' },
      { from: ['2026-10-01'], to: '2026-10-31' },
    ]) {
      expect(readPeriod(params)).toEqual({ period: null, invalid: true });
    }
  });
});

describe('money', () => {
  it('shows a dash for nothing and formats real amounts', () => {
    expect(money(0, 'EUR')).toBe('–');
    expect(money(7400, 'EUR')).toContain('74,00');
  });
});
