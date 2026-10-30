import { defineConfig } from 'vitest/config';

// Unit tests of the CMS rules; they need no database.
export default defineConfig({
  test: { include: ['collections/**/*.test.ts'] },
});
