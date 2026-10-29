import { type NextRequest, NextResponse } from 'next/server';
import { refreshSession } from './lib/oidc';
import { runtime } from './lib/runtime';
import { cookieOptions, sealSession, SESSION_COOKIE, unsealSession } from './lib/session';

// Runs before pages render: refreshes an access token that is about to expire,
// and drops a session that can no longer be refreshed (ADR 0014).

const REFRESH_MARGIN_SECONDS = 60;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const sealed = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sealed) return NextResponse.next();

  const { config, key, oidc } = runtime();
  const now = Math.floor(Date.now() / 1000);
  const session = await unsealSession(sealed, key);

  const endSession = () => {
    request.cookies.delete(SESSION_COOKIE);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(SESSION_COOKIE, '', cookieOptions(config.secureCookies, 0));
    return response;
  };

  if (!session || session.refreshExpiresAt <= now) return endSession();
  if (session.accessExpiresAt - now > REFRESH_MARGIN_SECONDS) return NextResponse.next();

  try {
    const refreshed = await refreshSession(oidc, session);
    const value = await sealSession(refreshed, key);
    request.cookies.set(SESSION_COOKIE, value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(
      SESSION_COOKIE,
      value,
      cookieOptions(config.secureCookies, refreshed.refreshExpiresAt - now),
    );
    return response;
  } catch {
    // Keycloak ended the session (sign-out elsewhere, idle limit): sign out here too.
    return endSession();
  }
}

export const config = {
  // Pages only: not static assets, and not the sign-in routes, which manage cookies themselves.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/).*)'],
};
