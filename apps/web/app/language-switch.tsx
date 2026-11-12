'use client';

import { type Language, LANGUAGES } from '@pythagoras/shared';
import { usePathname } from 'next/navigation';
import { createContext, type ReactNode, useContext } from 'react';
import { type Messages, messages } from '../lib/i18n/messages';

// The page's language for the few client components (M9.1, ADR 0039); the
// server decides it (lib/server.ts, currentLanguage) and the layout provides it.

const LanguageContext = createContext<Language>('en');

export function LanguageProvider({ language, children }: { language: Language; children: ReactNode }) {
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useMessages(): Messages {
  return messages(useContext(LanguageContext));
}

/**
 * EN / BG. A form, so it works before any script has loaded: /language saves
 * the choice in this browser and, when signed in, for the person, and comes
 * back to this page.
 */
export function LanguageSwitch() {
  const language = useContext(LanguageContext);
  const text = messages(language).shell;
  const path = usePathname();
  return (
    <form method="post" action="/language" className="language-switch" aria-label={text.language}>
      <input type="hidden" name="back" value={path} />
      {LANGUAGES.map((option) => (
        <button
          key={option}
          type="submit"
          name="language"
          value={option}
          lang={option}
          title={text.languageNames[option]}
          aria-label={text.languageNames[option]}
          aria-pressed={option === language}
          data-testid={`language-${option}`}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </form>
  );
}
