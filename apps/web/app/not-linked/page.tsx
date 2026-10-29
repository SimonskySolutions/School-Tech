import Link from 'next/link';

export default function NotLinkedPage() {
  return (
    <main data-testid="not-linked">
      <h1>This sign-in is not linked to a Pythagoras account</h1>
      <p>
        You signed in successfully, but no parent or staff record is connected to this account yet, so there
        is nothing to show. You have been signed out again.
      </p>
      <p>Please contact the school office and ask them to link your account.</p>
      <p>
        <Link href="/">Back to the start page</Link>
      </p>
    </main>
  );
}
