import { isLanguage } from '@pythagoras/shared';
import { type NextRequest, NextResponse } from 'next/server';
import { text } from '../../lib/admin';
import { writeApi } from '../../lib/api-client';
import { LANGUAGE_COOKIE, LANGUAGE_COOKIE_MAX_AGE } from '../../lib/i18n/messages';
import { currentSession, runtime } from '../../lib/server';
import { cookieOptions, safeReturnTo } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * The EN / BG switch (M9.1, ADR 0039): remembers the language in this browser
 * and, when signed in, saves it as the person's own; then back to the page.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const { config } = runtime();
  if (request.headers.get('origin') !== new URL(config.APP_URL).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const form = await request.formData();
  const language = text(form, 'language');
  const response = NextResponse.redirect(new URL(safeReturnTo(text(form, 'back')), config.APP_URL), 303);
  response.headers.set('cache-control', 'no-store');
  if (!isLanguage(language)) return response;

  response.cookies.set(
    LANGUAGE_COOKIE,
    language,
    cookieOptions(config.secureCookies, LANGUAGE_COOKIE_MAX_AGE),
  );
  const session = await currentSession();
  if (session) {
    // Logged: the page follows the saved choice, so it would stay in the old language.
    const saved = await writeApi(config.API_INTERNAL_URL, session.accessToken, 'PUT', '/me/language', {
      language,
    });
    if (saved.kind === 'refused' && saved.status !== 401) {
      console.warn(`language not saved: ${saved.status}`);
    }
  }
  return response;
}
