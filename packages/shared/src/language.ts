// The languages the platform speaks (M9.1, ADR 0039). English first: what the
// portal shows when nothing says otherwise.

export const LANGUAGES = ['en', 'bg'] as const;

export type Language = (typeof LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = 'en';

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (LANGUAGES as readonly string[]).includes(value);
}
