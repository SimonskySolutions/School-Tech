import Link from 'next/link';
import { currentMessages } from '../lib/server';
import { Logo } from './brand';

/** Any address that is not a page, on the portal or a school website. */
export default async function NotFound() {
  const { text } = await currentMessages();
  return (
    <main className="empty-state" data-testid="not-found">
      <Logo size={56} />
      <p className="eyebrow">{text.notFound.eyebrow}</p>
      <h1>{text.notFound.title}</h1>
      <p>{text.notFound.text}</p>
      <p>
        <Link href="/" className="button">
          {text.notFound.back}
        </Link>
      </p>
    </main>
  );
}
