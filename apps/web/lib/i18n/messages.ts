import { DEFAULT_LANGUAGE, isLanguage, type Language, LANGUAGES } from '@pythagoras/shared';
import { bg } from './bg';
import { en } from './en';

// Which language a page is shown in, and its words (M9.1, ADR 0039). Used on
// the server and in the few client components; nothing here reads a request.

export type Messages = typeof en;

const CATALOGS: Record<Language, Messages> = { en, bg };

/** The cookie that remembers the choice in this browser, signed in or not. */
export const LANGUAGE_COOKIE = 'pythagoras_language';

/** A year: the choice outlives sessions, and signing in brings back the saved one anyway. */
export const LANGUAGE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function messages(language: Language): Messages {
  return CATALOGS[language];
}

/** The locale for dates and numbers in a language. */
export function localeOf(language: Language): string {
  return language === 'bg' ? 'bg-BG' : 'en-GB';
}

/** The first of the platform's languages the browser asks for (Accept-Language), by its weights. */
export function fromAcceptLanguage(header: string | null | undefined): Language | null {
  if (!header) return null;
  const wanted = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((param) => param.trim()).find((param) => param.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return {
        language: tag.trim().toLowerCase().split('-')[0],
        weight: Number.isFinite(weight) ? weight : 0,
        index,
      };
    })
    .filter((entry) => entry.weight > 0 && isLanguage(entry.language))
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  const [first] = wanted;
  return first && isLanguage(first.language) ? first.language : null;
}

/**
 * The language to show: the person's own choice when signed in and made, else
 * this browser's last choice, else what the browser asks for, else English.
 */
export function chooseLanguage({
  saved,
  cookie,
  acceptLanguage,
}: {
  saved?: Language | null;
  cookie?: string | null;
  acceptLanguage?: string | null;
}): Language {
  if (saved) return saved;
  if (isLanguage(cookie)) return cookie;
  return fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LANGUAGE;
}

export { LANGUAGES };
