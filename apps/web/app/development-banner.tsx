/** Shown on every page while the platform runs on synthetic data and the development payment provider. */
export function DevelopmentBanner() {
  return (
    <p
      data-testid="development-banner"
      style={{ background: '#fff4ce', padding: '0.5rem 0.75rem', borderRadius: 4 }}
    >
      Development build with synthetic data. Payments use the development payment provider: no money moves.
    </p>
  );
}
