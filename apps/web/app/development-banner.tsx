/** Shown on every page while the platform runs on synthetic data and the development payment provider. */
export function DevelopmentBanner() {
  return (
    <p data-testid="development-banner" className="dev-banner">
      <span aria-hidden="true">●</span>
      Development build with synthetic data. Payments use the development payment provider: no money moves.
    </p>
  );
}
