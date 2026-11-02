'use client';

import Link from 'next/link';
import { Logo } from './brand';

/** A page that failed while rendering. The details stay in the server log; the digest ties them together. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="empty-state" data-testid="error-page">
      <Logo size={56} />
      <p className="eyebrow">Something went wrong</p>
      <h1>This page could not be shown</h1>
      <p>Please try again in a moment. If it keeps happening, tell the school office what you were doing.</p>
      {error.digest ? <p className="muted">{`Reference: ${error.digest}`}</p> : null}
      <p className="empty-state-actions">
        <button type="button" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="button soft">
          Start page
        </Link>
      </p>
    </main>
  );
}
