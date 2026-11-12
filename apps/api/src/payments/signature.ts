import { createHmac, timingSafeEqual } from 'node:crypto';

// Timestamped HMAC-SHA256 webhook signatures, in the scheme Stripe documents
// ("t=<unix seconds>,v1=<hex HMAC of `${t}.${body}`>"). The development
// provider uses the same scheme so both go through one verification path.

export const DEFAULT_TOLERANCE_SECONDS = 300;

export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${mac}`;
}

export type SignatureCheck = { ok: true } | { ok: false; reason: string };

export function verifySignature(
  secret: string,
  body: Buffer | string,
  header: string | undefined,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): SignatureCheck {
  if (!header) return { ok: false, reason: 'missing signature header' };
  const parts = header.split(',').map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
  if (!Number.isInteger(timestamp) || signatures.length === 0)
    return { ok: false, reason: 'malformed signature header' };
  if (Math.abs(now - timestamp) > toleranceSeconds)
    return { ok: false, reason: 'timestamp outside tolerance' };

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(typeof body === 'string' ? Buffer.from(body) : body)
    .digest();
  const matches = signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  return matches ? { ok: true } : { ok: false, reason: 'signature does not match' };
}

/** A signed body that is not JSON is refused like a bad signature, not answered with a 500. */
export function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
}
