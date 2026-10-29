import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // "server-only" throws outside a React Server environment; tests are server code.
    alias: { 'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)) },
  },
  test: {
    include: ['lib/**/*.test.ts'],
  },
});
