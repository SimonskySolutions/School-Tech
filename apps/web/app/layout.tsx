import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Pythagoras',
  description: 'Pythagoras school group',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="bg">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, padding: '2rem', lineHeight: 1.5 }}>
        {children}
      </body>
    </html>
  );
}
