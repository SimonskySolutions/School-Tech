/** On the CMS login page: editors sign in with their Pythagoras (Keycloak) account (ADR 0019). */
export function SsoButton() {
  return (
    <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
      <a
        href="/sso/login"
        data-testid="sso-sign-in"
        style={{
          display: 'inline-block',
          padding: '0.6rem 1.2rem',
          borderRadius: 4,
          background: 'var(--theme-elevation-800)',
          color: 'var(--theme-elevation-0)',
          textDecoration: 'none',
        }}
      >
        Sign in with your Pythagoras account
      </a>
    </div>
  );
}
