import 'server-only';
import { type Language } from '@pythagoras/shared';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { fetchMe } from './api-client';
import { chooseLanguage, LANGUAGE_COOKIE, type Messages, messages } from './i18n/messages';
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

/** Who the signed-in person is, asked of the API once per request however many parts of the page need it. */
export const myself = cache((accessToken: string) => fetchMe(runtime().config.API_INTERNAL_URL, accessToken));

/** The language this request is shown in (lib/i18n/messages.ts, chooseLanguage). */
export const currentLanguage = cache(async (): Promise<Language> => {
  const [jar, request, session] = await Promise.all([cookies(), headers(), currentSession()]);
  const me = session ? await myself(session.accessToken) : null;
  return chooseLanguage({
    saved: me?.kind === 'ok' ? me.value.person.language : null,
    cookie: jar.get(LANGUAGE_COOKIE)?.value,
    acceptLanguage: request.get('accept-language'),
  });
});

/** The words of this request's language. */
export async function currentMessages(): Promise<{ language: Language; text: Messages }> {
  const language = await currentLanguage();
  return { language, text: messages(language) };
}
