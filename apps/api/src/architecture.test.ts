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
    expect(importers.sort()).toEqual(['database/database.ts', 'database/system-database.ts']);
  });

  it('only the worker uses system database access', () => {
    const importers = files
      .filter((file) => file.text.includes('system-database') && !file.path.startsWith('database/'))
      .map((file) => file.path);
    expect(importers.every((path) => path.startsWith('worker/'))).toBe(true);
    expect(importers.length).toBeGreaterThan(0);
  });

  it('the API never imports worker code', () => {
    const importers = files
      .filter((file) => !file.path.startsWith('worker/') && /from ['"]\.\.?\/(.*\/)?worker\//.test(file.text))
      .map((file) => file.path);
    expect(importers).toEqual([]);
  });

  it('only health checks, the certificate and website look-ups, the website inquiry form, webhooks and the development checkout are public', () => {
    const publicFiles = files
      .filter((file) => file.text.includes('@Public()') && !file.path.startsWith('auth/'))
      .map((file) => file.path);
    expect(publicFiles.sort()).toEqual([
      'admissions/inquiries.controller.ts',
      'health/health.controller.ts',
      'org/sites.controller.ts',
      'org/tls.controller.ts',
      'payments/dev-checkout.controller.ts',
      'payments/webhook.controller.ts',
    ]);
  });

  it('test helpers are never imported by application code', () => {
    const importers = files
      .filter((file) => file.text.includes("from './test-keys'"))
      .map((file) => file.path);
    expect(importers).toEqual([]);
  });
});
