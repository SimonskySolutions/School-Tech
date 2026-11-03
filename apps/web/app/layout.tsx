import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { fetchSchools } from '../lib/api-client';
import { buildHome } from '../lib/home';
import { currentMessages, currentSession, myself, runtime } from '../lib/server';
import { SITE_HOST_HEADER } from '../lib/sites';
import { AppShell } from './app-shell';
import { LanguageProvider } from './language-switch';
import './globals.css';

export const metadata: Metadata = {
  title: 'Pythagoras',
  description: 'Pythagoras school group',
  robots: { index: false, follow: false },
};

/**
 * Every page shares the design (docs/design.md). A school website keeps its
 * own simple frame; a signed-in person gets the application shell with what
 * they can reach; everyone else (signing in, signed out) gets the page alone.
 * The portal is in the language the person or their browser chose (M9.1).
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  if ((await headers()).get(SITE_HOST_HEADER)) {
    return (
      <html lang="bg">
        <body className="site">{children}</body>
      </html>
    );
  }
  const { language, text } = await currentMessages();
  const session = await currentSession();
  if (session) {
    const { config } = runtime();
    const [me, schools] = await Promise.all([
      myself(session.accessToken),
      fetchSchools(config.API_INTERNAL_URL, session.accessToken),
    ]);
    if (me.kind === 'ok') {
      return (
        <html lang={language}>
          <body>
            <LanguageProvider language={language}>
              <AppShell
                view={buildHome(me.value, schools.kind === 'ok' ? schools.value : [], text)}
                person={me.value.person}
                text={text}
              >
                {children}
              </AppShell>
            </LanguageProvider>
          </body>
        </html>
      );
    }
  }
  return (
    <html lang={language}>
      <body>
        <LanguageProvider language={language}>{children}</LanguageProvider>
      </body>
    </html>
  );
}
