import { randomBytes } from 'node:crypto';

// Real domains for websites (M3.6, ADR 0018). An administrator adds a domain;
// the school proves it controls the domain with a DNS TXT record holding a
// random token; the worker checks and marks it verified. Only then is the
// domain routed (org.resolve_hostname) and given a certificate (on-demand
// TLS asks /internal/tls/allowed). Pure rules here, so they are unit-tested.

export const RECORD_PREFIX = '_pythagoras-verify';
export const VALUE_PREFIX = 'pythagoras-site-verification=';

/** Domains are checked at most this often while pending, and given up after this long. */
export const CHECK_EVERY_MINUTES = 5;
export const GIVE_UP_AFTER_DAYS = 14;

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export class DomainProblem extends Error {}

/** A domain as typed by an administrator, checked and lower-cased; never a development or internal name. */
export function normaliseDomain(input: string): string {
  const hostname = input.trim().toLowerCase().replace(/\.$/, '');
  const labels = hostname.split('.');
  if (
    hostname.length > 253 ||
    labels.length < 2 ||
    !labels.every((label) => LABEL.test(label)) ||
    !/^[a-z]/.test(labels.at(-1)!)
  ) {
    throw new DomainProblem(`"${input}" is not a domain name, for example www.school-d.bg`);
  }
  if (/\.(localhost|test|local|internal|invalid|example)$/.test(hostname) || hostname === 'localhost') {
    throw new DomainProblem(
      `"${hostname}" is a reserved name; development addresses are created by the platform`,
    );
  }
  return hostname;
}

export function newToken(bytes: (size: number) => Buffer = randomBytes): string {
  return bytes(24).toString('base64url');
}

/** What the school puts in its DNS. */
export function dnsInstructions(hostname: string, token: string) {
  return { type: 'TXT' as const, name: `${RECORD_PREFIX}.${hostname}`, value: `${VALUE_PREFIX}${token}` };
}

export type Resolver = (name: string) => Promise<string[][]>;

/**
 * Whether the TXT record is in place. A missing name is "not yet"; any other
 * DNS trouble is also "not yet", never "verified".
 */
export async function hasVerificationRecord(
  hostname: string,
  token: string,
  resolveTxt: Resolver,
): Promise<boolean> {
  const expected = dnsInstructions(hostname, token).value;
  try {
    const records = await resolveTxt(dnsInstructions(hostname, token).name);
    // A TXT record may be split into several strings; join each record first.
    return records.some((parts) => parts.join('') === expected);
  } catch {
    return false;
  }
}
