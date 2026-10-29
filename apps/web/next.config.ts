import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // The callback URL carries a one-time code; never pass it on as a referrer.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

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
