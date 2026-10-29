import 'server-only';
import { cookies } from 'next/headers';
import { runtime } from './runtime';
import { type Session, SESSION_COOKIE, unsealSession } from './session';

export { runtime };

/** The session from the request cookie (already refreshed by the proxy when needed), or null. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const session = await unsealSession(jar.get(SESSION_COOKIE)?.value, runtime().key);
  if (!session || session.accessExpiresAt <= Math.floor(Date.now() / 1000)) return null;
  return session;
}
