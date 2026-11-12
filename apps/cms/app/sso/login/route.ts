import config from '@payload-config';
import { NextResponse } from 'next/server';
import { getPayload } from 'payload';
import { beginSignIn, ssoSettings, TRANSACTION_COOKIE } from '../../../sso/flow';

export const dynamic = 'force-dynamic';

/** Starts "Sign in with your Pythagoras account" (ADR 0019). */
export async function GET(): Promise<NextResponse> {
  const settings = ssoSettings();
  const payload = await getPayload({ config });
  const { url, cookie } = await beginSignIn(settings, payload.secret);
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(TRANSACTION_COOKIE, cookie, {
    httpOnly: true,
    // Lax: the cookie must come back on Keycloak's redirect to the callback.
    sameSite: 'lax',
    secure: settings.secure,
    path: '/sso',
    maxAge: 600,
  });
  response.headers.set('cache-control', 'no-store');
  return response;
}
