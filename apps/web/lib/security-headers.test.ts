import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security-headers';

const header = (key: string) => securityHeaders.find((entry) => entry.key === key)?.value;

describe('securityHeaders', () => {
  it('keeps the address from other sites without stripping the origin from form posts', () => {
    // "no-referrer" makes browsers send "Origin: null" on form posts, which
    // every action route refuses: Sign out answered "Forbidden".
    expect(header('Referrer-Policy')).toBe('same-origin');
  });

  it('cannot be framed and sniffs no types', () => {
    expect(header('X-Frame-Options')).toBe('DENY');
    expect(header('X-Content-Type-Options')).toBe('nosniff');
  });
});
