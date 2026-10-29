import { type NextRequest, NextResponse } from 'next/server';
import { beginSignIn } from '../../../lib/oidc';
import { runtime } from '../../../lib/server';
import {
  cookieOptions,
  safeReturnTo,
  sealSignIn,
  SIGN_IN_COOKIE,
  SIGN_IN_TTL_SECONDS,
} from '../../../lib/session';

export const dynamic = 'force-dynamic';

/** Starts sign-in: remembers state, nonce and PKCE verifier, then sends the browser to Keycloak. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { config, key, oidc } = runtime();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const { url, transaction } = await beginSignIn(oidc, config, returnTo);

  const response = NextResponse.redirect(url, 303);
  response.cookies.set(
    SIGN_IN_COOKIE,
    await sealSignIn(transaction, key),
    cookieOptions(config.secureCookies, SIGN_IN_TTL_SECONDS),
  );
  response.headers.set('cache-control', 'no-store');
  return response;
}
