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

  it('only the object store module talks to the document store (ADR 0029)', () => {
    const importers = files.filter((file) => /from ['"]@aws-sdk\//.test(file.text)).map((file) => file.path);
    expect(importers).toEqual(['documents/object-store.ts']);
  });

  it('only the mail transport talks to the mail service (ADR 0031)', () => {
    const importers = files
      .filter((file) => /from ['"]nodemailer['"]/.test(file.text))
      .map((file) => file.path);
    expect(importers).toEqual(['worker/mail-transport.ts']);
  });

  it('names no integration that waits for its contract (ADR 0032)', () => {
    // Application code, pages, the CMS, shared types and seeds: never docs or
    // migrations, which describe the boundary.
    const ROOT = join(__dirname, '..', '..', '..');
    const SKIP = new Set(['node_modules', '.next', 'dist', '.turbo']);
    const scan = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return SKIP.has(entry.name) ? [] : scan(path);
        return /\.(ts|tsx|sql)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
      });
    const sources = [
      'apps/api/src',
      'apps/web/app',
      'apps/web/lib',
      'apps/cms',
      'packages/shared/src',
      'db/seeds',
    ].flatMap(scan);
    const WAITING =
      /shkolo|evrotrust|b-trust|borica|infonotary|stampit|neispuo|(?<!\p{L})(НЕИСПУО|НАП|НОИ)(?!\p{L})/iu;
    const naming = sources.filter((path) => WAITING.test(readFileSync(join(ROOT, path), 'utf8')));
    expect(sources.length).toBeGreaterThan(100);
    expect(naming).toEqual([]);
  });

  it('records each waiting integration as not built, with no adapter (ADR 0032)', () => {
    const register = readFileSync(
      join(__dirname, '..', '..', '..', 'docs', 'integration-register.md'),
      'utf8',
    );
    for (const system of [
      '| Shkolo |',
      '| Qualified e-signature |',
      '| Statutory payroll and official reporting',
    ]) {
      const row = register.split('\n').find((line) => line.startsWith(system));
      expect(row, system).toBeDefined();
      expect(row).toContain('**Not built');
      expect(row).toContain('Development adapter: none');
    }
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
