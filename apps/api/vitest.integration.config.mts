import { defineConfig } from 'vitest/config';

// Integration tests talk to the running Compose stack over HTTP. Files run one
// after another: they share the development database, and some compare counts.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
