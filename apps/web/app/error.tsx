'use client';

import Link from 'next/link';
import { Logo } from './brand';
import { useMessages } from './language-switch';

/** A page that failed while rendering. The details stay in the server log; the digest ties them together. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const text = useMessages().errorPage;
  return (
    <main className="empty-state" data-testid="error-page">
      <Logo size={56} />
      <p className="eyebrow">{text.eyebrow}</p>
      <h1>{text.title}</h1>
      <p>{text.text}</p>
      {error.digest ? <p className="muted">{text.reference(error.digest)}</p> : null}
      <p className="empty-state-actions">
        <button type="button" onClick={reset}>
          {text.tryAgain}
        </button>
        <Link href="/" className="button soft">
          {text.startPage}
        </Link>
      </p>
    </main>
  );
}
