import { EncryptJWT, jwtDecrypt } from 'jose';
import { z } from 'zod';

// Encrypted, authenticated cookies (ADR 0014). Two kinds, never interchangeable:
// the sign-in transaction (state, nonce, PKCE verifier) and the session (tokens).

export const SESSION_COOKIE = 'pyth_session';
export const SIGN_IN_COOKIE = 'pyth_sign_in';
export const SIGN_IN_TTL_SECONDS = 600;

const sessionSchema = z.object({
  purpose: z.literal('session'),
  subject: z.string().min(1),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessExpiresAt: z.number().int(),
  refreshExpiresAt: z.number().int(),
});

const signInSchema = z.object({
  purpose: z.literal('sign-in'),
  state: z.string().min(16),
  nonce: z.string().min(16),
  codeVerifier: z.string().min(43),
  returnTo: z.string().startsWith('/'),
});

export type Session = Omit<z.infer<typeof sessionSchema>, 'purpose'>;
export type SignInTransaction = Omit<z.infer<typeof signInSchema>, 'purpose'>;

export function keyFromSecret(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('session secret must be 64 hex characters');
  return Uint8Array.from(hex.match(/../g)!.map((byte) => parseInt(byte, 16)));
}

async function seal(payload: Record<string, unknown>, key: Uint8Array, expiresAt: number): Promise<string> {
  return new EncryptJWT(payload)
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .encrypt(key);
}

async function unseal<T>(
  value: string | undefined,
  key: Uint8Array,
  schema: z.ZodType<T>,
): Promise<T | null> {
  if (!value) return null;
  try {
    const { payload } = await jwtDecrypt(value, key, {
      keyManagementAlgorithms: ['dir'],
      contentEncryptionAlgorithms: ['A256GCM'],
    });
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  } catch {
    // Tampered, expired, or sealed with another key: treat as no cookie.
    return null;
  }
}

export function sealSession(session: Session, key: Uint8Array): Promise<string> {
  return seal({ purpose: 'session', ...session }, key, session.refreshExpiresAt);
}

export async function unsealSession(value: string | undefined, key: Uint8Array): Promise<Session | null> {
  const parsed = await unseal(value, key, sessionSchema);
  if (!parsed) return null;
  const { purpose: _purpose, ...session } = parsed;
  return session;
}

export function sealSignIn(
  transaction: SignInTransaction,
  key: Uint8Array,
  now = Date.now(),
): Promise<string> {
  return seal({ purpose: 'sign-in', ...transaction }, key, Math.floor(now / 1000) + SIGN_IN_TTL_SECONDS);
}

export async function unsealSignIn(
  value: string | undefined,
  key: Uint8Array,
): Promise<SignInTransaction | null> {
  const parsed = await unseal(value, key, signInSchema);
  if (!parsed) return null;
  const { purpose: _purpose, ...transaction } = parsed;
  return transaction;
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  path: '/';
  secure: boolean;
  maxAge: number;
}

export function cookieOptions(secure: boolean, maxAgeSeconds: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure,
    maxAge: Math.max(0, Math.floor(maxAgeSeconds)),
  };
}

/** Accepts only a path on this site; anything else (absolute URLs, //host, \) becomes "/". */
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  try {
    const url = new URL(value, 'http://placeholder.invalid');
    return url.origin === 'http://placeholder.invalid' ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}
