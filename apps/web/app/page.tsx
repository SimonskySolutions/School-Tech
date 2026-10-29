import { formatMoney } from '@pythagoras/shared';

// Development build page. Sign-in and the role-specific workspaces arrive in
// milestone M1.4; until then this page states plainly that nothing is live.
export default function HomePage() {
  return (
    <main>
      <h1>Pythagoras</h1>
      <p>
        <strong>Development build.</strong> Sign-in, the family portal and the staff workspaces are not built
        yet (milestone M1.4).
      </p>
      <p>
        Shared package check: a lunch at 450 cents is shown as <code>{formatMoney(450)}</code>.
      </p>
    </main>
  );
}
