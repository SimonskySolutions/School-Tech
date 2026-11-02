/** On the CMS login page: editors sign in with their Pythagoras (Keycloak) account (ADR 0019). */
export function SsoButton() {
  return (
    <div style={{ marginTop: '1.5rem' }}>
      <a href="/sso/login" data-testid="sso-sign-in" className="pyth-sso">
        Sign in with your Pythagoras account
      </a>
    </div>
  );
}
