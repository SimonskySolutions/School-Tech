import { defineConfig } from 'vitest/config';

// End-to-end tests against the running Compose stack.
export default defineConfig({
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
