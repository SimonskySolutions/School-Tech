import Link from 'next/link';
import { Logo } from './brand';

/** Any address that is not a page, on the portal or a school website. */
export default function NotFound() {
  return (
    <main className="empty-state" data-testid="not-found">
      <Logo size={56} />
      <p className="eyebrow">Error 404</p>
      <h1>This page does not exist</h1>
      <p>The address may be mistyped, or the page may have moved. Nothing you did was lost.</p>
      <p>
        <Link href="/" className="button">
          Go to the start page
        </Link>
      </p>
    </main>
  );
}
