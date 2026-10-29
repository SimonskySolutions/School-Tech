import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Structural rules from ADR 0013, checked on the source tree.

const SRC = join(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));

describe('architecture', () => {
  it('only the database module talks to PostgreSQL directly', () => {
    const importers = files.filter((file) => /from ['"]pg['"]/.test(file.text)).map((file) => file.path);
    expect(importers).toEqual(['database/database.ts']);
  });

  it('only health checks are public routes', () => {
    const publicFiles = files
      .filter((file) => file.text.includes('@Public()') && !file.path.startsWith('auth/'))
      .map((file) => file.path);
    expect(publicFiles).toEqual(['health/health.controller.ts']);
  });

  it('test helpers are never imported by application code', () => {
    const importers = files
      .filter((file) => file.text.includes("from './test-keys'"))
      .map((file) => file.path);
    expect(importers).toEqual([]);
  });
});
