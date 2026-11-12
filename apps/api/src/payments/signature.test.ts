import { describe, expect, it } from 'vitest';
import { signPayload, verifySignature } from './signature';

const SECRET = 'whsec_test_0123456789abcdef';
const BODY = '{"id":"evt_1"}';
const NOW = 1_800_000_000;

describe('webhook signatures', () => {
  it('accepts a body signed with the secret within the time window', () => {
    expect(verifySignature(SECRET, BODY, signPayload(SECRET, BODY, NOW - 10), NOW)).toEqual({ ok: true });
  });

  it('matches the documented Stripe scheme (t=..., v1=HMAC of "t.body")', async () => {
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha256', SECRET).update(`${NOW}.${BODY}`).digest('hex');
    expect(signPayload(SECRET, BODY, NOW)).toBe(`t=${NOW},v1=${expected}`);
  });

  it('accepts any of several v1 signatures (secret rotation)', () => {
    const header = `${signPayload('old-secret', BODY, NOW)},${signPayload(SECRET, BODY, NOW).split(',')[1]}`;
    expect(verifySignature(SECRET, BODY, header, NOW).ok).toBe(true);
  });

  it('refuses a changed body, a wrong secret, a stale timestamp and a missing header', () => {
    const header = signPayload(SECRET, BODY, NOW);
    expect(verifySignature(SECRET, '{"id":"evt_2"}', header, NOW)).toEqual({
      ok: false,
      reason: 'signature does not match',
    });
    expect(verifySignature('other', BODY, header, NOW).ok).toBe(false);
    expect(verifySignature(SECRET, BODY, header, NOW + 301)).toEqual({
      ok: false,
      reason: 'timestamp outside tolerance',
    });
    expect(verifySignature(SECRET, BODY, undefined, NOW).ok).toBe(false);
    expect(verifySignature(SECRET, BODY, 'v1=abc', NOW)).toEqual({
      ok: false,
      reason: 'malformed signature header',
    });
    expect(verifySignature(SECRET, BODY, `t=${NOW},v1=zz`, NOW).ok).toBe(false);
  });
});
