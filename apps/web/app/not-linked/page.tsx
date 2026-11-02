import Link from 'next/link';
import { Logo } from '../brand';
import { DevelopmentBanner } from '../development-banner';

export default function NotLinkedPage() {
  return (
    <div className="auth-page">
      <main data-testid="not-linked" className="auth-card" style={{ padding: 0 }}>
        <Logo size={56} />
        <h1>This sign-in is not linked to a Pythagoras account</h1>
        <p>
          You signed in successfully, but no parent or staff record is connected to this account yet, so there
          is nothing to show. You have been signed out again.
        </p>
        <p>Please contact the school office and ask them to link your account.</p>
        <p style={{ margin: 0 }}>
          <Link href="/" className="button">
            Back to the start page
          </Link>
        </p>
        <DevelopmentBanner />
      </main>
    </div>
  );
}
