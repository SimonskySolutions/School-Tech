import { withPayload } from '@payloadcms/next/withPayload';
import type { NextConfig } from 'next';

// The website CMS (ADR 0017): Payload's admin UI and REST API only. Public
// pages are rendered by apps/web, which reads published content from here.

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
];

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  poweredByHeader: false,
  reactStrictMode: true,
  // File events do not cross from Windows into the development container (ADR 0012).
  ...(process.env.WATCHPACK_POLLING === 'true' ? { watchOptions: { pollIntervalMs: 1000 } } : {}),
  headers: async () => [{ source: '/:path*', headers: securityHeaders }],
};

export default withPayload(config);
