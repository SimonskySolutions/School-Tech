import { isLanguage } from '@pythagoras/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { fetchMe, writeApi } from '../../../lib/api-client';
import { LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE } from '../../../lib/i18n/messages';
import { completeSignIn, endIdentitySession } from '../../../lib/oidc';
import { runtime } from '../../../lib/server';
import {
  cookieOptions,
  sealSession,
  SESSION_COOKIE,
  SIGN_IN_COOKIE,
  unsealSignIn,
} from '../../../lib/session';

export const dynamic = 'force-dynamic';

/** Keycloak sends the browser back here with a one-time code. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { config, key, oidc } = runtime();

  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, config.APP_URL), 303);
    response.cookies.set(SIGN_IN_COOKIE, '', cookieOptions(config.secureCookies, 0));
    response.headers.set('cache-control', 'no-store');
    return response;
  };

  const transaction = await unsealSignIn(request.cookies.get(SIGN_IN_COOKIE)?.value, key);
  if (!transaction) {
    return redirect('/?error=sign-in-expired');
  }

  // The URL Keycloak redirected to, rebuilt from the configured address rather
  // than from request headers, which a proxy or client could alter.
  const currentUrl = new URL(`/auth/callback${request.nextUrl.search}`, config.APP_URL);

  let session;
  try {
    session = await completeSignIn(oidc, currentUrl, transaction);
  } catch (error) {
    console.warn(`sign-in failed: ${error instanceof Error ? error.name : 'unknown error'}`);
    return redirect('/?error=sign-in-failed');
  }

  const me = await fetchMe(config.API_INTERNAL_URL, session.accessToken);
  if (me.kind === 'unlinked') {
    // A valid Keycloak account without a Pythagoras person: no session here or there.
    await endIdentitySession(config, session.refreshToken).catch(() => false);
    return redirect('/not-linked');
  }
  if (me.kind === 'signed-out' && me.secondFactor && !transaction.secondFactor) {
    // Staff: sign in again with the second factor. Keycloak keeps the password
    // step, so only the one-time code is asked for.
    const again = new URLSearchParams({ 'second-factor': '1', returnTo: transaction.returnTo });
    return redirect(`/auth/sign-in?${again.toString()}`);
  }
  if (me.kind !== 'ok') {
    return redirect('/?error=sign-in-failed');
  }

  const response = redirect(transaction.returnTo);
  const now = Math.floor(Date.now() / 1000);
  response.cookies.set(
    SESSION_COOKIE,
    await sealSession(session, key),
    cookieOptions(config.secureCookies, session.refreshExpiresAt - now),
  );

  // The person's language (M9.1): a saved choice comes back to this browser;
  // one made here before signing in becomes theirs.
  const saved = me.value.person.language;
  const chosen = request.cookies.get(LANGUAGE_COOKIE)?.value;
  if (saved) {
    response.cookies.set(
      LANGUAGE_COOKIE,
      saved,
      cookieOptions(config.secureCookies, LANGUAGE_COOKIE_MAX_AGE),
    );
  } else if (isLanguage(chosen)) {
    await writeApi(config.API_INTERNAL_URL, session.accessToken, 'PUT', '/me/language', {
      language: chosen,
    }).catch(() => undefined);
  }
  return response;
}
