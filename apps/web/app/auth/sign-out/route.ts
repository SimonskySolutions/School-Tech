import { type NextRequest, NextResponse } from 'next/server';
import { endIdentitySession } from '../../../lib/oidc';
import { runtime } from '../../../lib/server';
import { cookieOptions, SESSION_COOKIE, unsealSession } from '../../../lib/session';

export const dynamic = 'force-dynamic';

/** Signs out: ends the Keycloak session through the back channel and deletes the cookie. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { config, key } = runtime();

  // Only a form on this site may sign the person out.
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const session = await unsealSession(request.cookies.get(SESSION_COOKIE)?.value, key);
  if (session) {
    await endIdentitySession(config, session.refreshToken).catch(() => false);
  }

  const response = NextResponse.redirect(new URL('/?signed-out=1', config.APP_URL), 303);
  response.cookies.set(SESSION_COOKIE, '', cookieOptions(config.secureCookies, 0));
  response.headers.set('cache-control', 'no-store');
  return response;
}
