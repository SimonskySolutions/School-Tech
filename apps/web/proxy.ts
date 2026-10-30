import { type NextRequest, NextResponse } from 'next/server';
import { refreshSession } from './lib/oidc';
import { runtime } from './lib/runtime';
import { cookieOptions, sealSession, SESSION_COOKIE, unsealSession } from './lib/session';
import { SITE_HOST_HEADER, SITE_PREFIX, websiteHost } from './lib/sites';

// Runs before pages render. A request for a school or group website is
// rewritten to the website pages (M3.5): websites have no sign-in, so no
// session is touched. On the portal it refreshes an access token that is about
// to expire, and drops a session that can no longer be refreshed (ADR 0014).

const REFRESH_MARGIN_SECONDS = 60;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { config, key, oidc } = runtime();
  const path = request.nextUrl.pathname;

  const site = websiteHost(request.headers, new URL(config.APP_URL).host);
  if (site) {
    const target = request.nextUrl.clone();
    target.pathname = `${SITE_PREFIX}${path === '/' ? '' : path}`;
    const headers = new Headers(request.headers);
    headers.set(SITE_HOST_HEADER, site);
    // Website visitors never send or receive the portal's session cookie.
    headers.delete('cookie');
    return NextResponse.rewrite(target, { request: { headers } });
  }
  // The website pages exist only behind a website host.
  if (path === SITE_PREFIX || path.startsWith(`${SITE_PREFIX}/`)) {
    return NextResponse.rewrite(new URL('/not-found-page', request.url), { status: 404 });
  }
  // The sign-in routes manage the session cookie themselves.
  if (path.startsWith('/auth/')) return NextResponse.next();

  const sealed = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sealed) return NextResponse.next();

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
  // Everything but static assets: website hosts are routed here, including their /auth paths.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
