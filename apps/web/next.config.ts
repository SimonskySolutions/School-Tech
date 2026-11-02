import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

const config: NextConfig = {
  // Self-contained server bundle for the production image (M1.6).
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  poweredByHeader: false,
  reactStrictMode: true,
  // File events do not cross from Windows into the development container (ADR 0012).
  ...(process.env.WATCHPACK_POLLING === 'true' ? { watchOptions: { pollIntervalMs: 1000 } } : {}),
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default config;
