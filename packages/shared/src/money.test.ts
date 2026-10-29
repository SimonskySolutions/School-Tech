import { describe, expect, it } from 'vitest';
import { formatMoney, minorUnitDigits, parseMoney, sumMoney } from './money.js';

const NBSP = ' ';

describe('formatMoney', () => {
  it('formats euro cents the Bulgarian way', () => {
    expect(formatMoney(450)).toBe(`4,50${NBSP}€`);
    expect(formatMoney(45000)).toBe(`450,00${NBSP}€`);
    expect(formatMoney(0)).toBe(`0,00${NBSP}€`);
  });

  it('formats for other locales on request', () => {
    expect(formatMoney(123456, 'EUR', 'en-IE')).toBe('€1,234.56');
  });

  it('respects currencies without minor units', () => {
    expect(minorUnitDigits('JPY')).toBe(0);
    expect(formatMoney(500, 'JPY', 'en-US')).toBe('¥500');
  });

  it('refuses fractional or unsafe amounts', () => {
    expect(() => formatMoney(4.5)).toThrow(RangeError);
    expect(() => formatMoney(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => formatMoney(100, 'eur')).toThrow(RangeError);
  });
});

describe('parseMoney', () => {
  it.each([
    ['4.50', 450],
    ['4,50', 450],
    ['4,5', 450],
    ['12', 1200],
    [' 0.01 ', 1],
    ['0', 0],
  ])('parses %j as %i cents', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it('never goes through floating point', () => {
    // 0.1 + 0.2 style errors: 1.15 * 100 === 114.99999999999999 in floating point.
    expect(parseMoney('1.15')).toBe(115);
    expect(parseMoney('19.99')).toBe(1999);
  });

  it.each(['', '4.505', '-1', '1,000.00', '1e3', 'abc', '4.', '.5'])('rejects %j', (input) => {
    expect(() => parseMoney(input)).toThrow(RangeError);
  });
});

describe('sumMoney', () => {
  it('adds integer amounts', () => {
    expect(sumMoney([450, 480, 500])).toBe(1430);
    expect(sumMoney([])).toBe(0);
  });

  it('refuses non-integers', () => {
    expect(() => sumMoney([1, 0.5])).toThrow(RangeError);
  });
});
