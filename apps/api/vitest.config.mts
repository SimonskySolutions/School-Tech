import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC compiles NestJS decorators with metadata, which esbuild does not emit.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts'],
  },
});
