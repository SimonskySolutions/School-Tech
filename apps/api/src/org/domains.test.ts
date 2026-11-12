import { describe, expect, it } from 'vitest';
import { dnsInstructions, DomainProblem, hasVerificationRecord, newToken, normaliseDomain } from './domains';

describe('normaliseDomain', () => {
  it('accepts real domains, lower-cased and without a trailing dot', () => {
    expect(normaliseDomain(' WWW.School-D.bg. ')).toBe('www.school-d.bg');
    expect(normaliseDomain('school-d.eu')).toBe('school-d.eu');
  });

  it('refuses what is not a domain, and reserved or development names', () => {
    for (const input of [
      'school',
      'localhost',
      'school d.bg',
      'http://school-d.bg',
      '-x.bg',
      'school.123',
      'a..bg',
    ]) {
      expect(() => normaliseDomain(input)).toThrow(DomainProblem);
    }
    for (const input of ['school-d.pythagoras.localhost', 'school-d.test', 'x.example']) {
      expect(() => normaliseDomain(input)).toThrow('reserved');
    }
  });
});

describe('DNS verification', () => {
  const token = newToken();

  it('tells the school exactly which record to create', () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(dnsInstructions('www.school-d.bg', 'abc')).toEqual({
      type: 'TXT',
      name: '_pythagoras-verify.www.school-d.bg',
      value: 'pythagoras-site-verification=abc',
    });
  });

  it('finds the record, also when DNS splits it into parts', async () => {
    const value = `pythagoras-site-verification=${token}`;
    const resolver = (name: string) =>
      Promise.resolve(
        name === '_pythagoras-verify.www.school-d.bg'
          ? [['v=spf1 -all'], [value.slice(0, 20), value.slice(20)]]
          : [],
      );
    expect(await hasVerificationRecord('www.school-d.bg', token, resolver)).toBe(true);
    expect(await hasVerificationRecord('www.school-d.bg', 'other-token', resolver)).toBe(false);
  });

  it('treats a missing name or a DNS failure as "not yet"', async () => {
    const failing = () =>
      Promise.reject(Object.assign(new Error('queryTxt ENOTFOUND'), { code: 'ENOTFOUND' }));
    expect(await hasVerificationRecord('www.school-d.bg', token, failing)).toBe(false);
  });
});
