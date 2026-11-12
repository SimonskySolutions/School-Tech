import Link from 'next/link';
import { currentMessages } from '../../lib/server';
import { Logo } from '../brand';
import { DevelopmentBanner } from '../development-banner';
import { LanguageSwitch } from '../language-switch';

export default async function NotLinkedPage() {
  const { text } = await currentMessages();
  return (
    <div className="auth-page">
      <main data-testid="not-linked" className="auth-card" style={{ padding: 0 }}>
        <div className="auth-card-head">
          <Logo size={56} />
          <LanguageSwitch />
        </div>
        <h1>{text.notLinked.title}</h1>
        <p>{text.notLinked.text}</p>
        <p>{text.notLinked.contact}</p>
        <p style={{ margin: 0 }}>
          <Link href="/" className="button">
            {text.notLinked.back}
          </Link>
        </p>
        <DevelopmentBanner />
      </main>
    </div>
  );
}
