import { currentMessages } from '../lib/server';

/** Shown on every page while the platform runs on synthetic data and the development payment provider. */
export async function DevelopmentBanner() {
  const { text } = await currentMessages();
  return (
    <p data-testid="development-banner" className="dev-banner">
      <span aria-hidden="true">●</span>
      {text.shell.developmentBanner}
    </p>
  );
}
