import { defineConfig } from 'vitest/config';

// Integration tests talk to the running Compose stack over HTTP.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
