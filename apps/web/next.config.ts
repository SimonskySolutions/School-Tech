import type { NextConfig } from 'next';

const config: NextConfig = {
  // Self-contained server bundle for the production image (M1.6).
  output: 'standalone',
  outputFileTracingRoot: new URL('../..', import.meta.url).pathname,
  poweredByHeader: false,
  reactStrictMode: true,
};

export default config;
