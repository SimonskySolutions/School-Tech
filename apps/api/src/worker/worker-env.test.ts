import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './worker-env';

const read = (files: Record<string, string>) => (path: string) => {
  const content = files[path];
  if (content === undefined) throw new Error(`missing ${path}`);
  return content;
};

describe('worker configuration', () => {
  it('connects as pyth_worker and pyth_queue by default, with secrets from files', () => {
    const env = loadWorkerEnv(
      { DB_PASSWORD_FILE: '/run/secrets/db', REDIS_PASSWORD_FILE: '/run/secrets/redis' },
      read({ '/run/secrets/db': 'db-pass\n', '/run/secrets/redis': 'redis-pass\n' }),
    );
    expect(env).toMatchObject({
      DB_HOST: 'postgres',
      DB_USER: 'pyth_worker',
      DB_PASSWORD: 'db-pass',
      REDIS_HOST: 'redis',
      REDIS_USERNAME: 'pyth_queue',
      REDIS_PASSWORD: 'redis-pass',
      QUEUE_PREFIX: 'pyth',
      METRICS_PORT: 9464,
    });
  });

  it('requires hosts and passwords in production', () => {
    expect(() => loadWorkerEnv({ NODE_ENV: 'production' }, read({}))).toThrow(
      /DB_HOST: required[\s\S]*DB_PASSWORD[\s\S]*REDIS_HOST[\s\S]*REDIS_PASSWORD/,
    );
  });

  it('requires TLS to the database and Redis in production (M8.4)', () => {
    expect(() => loadWorkerEnv({ NODE_ENV: 'production' }, read({}))).toThrow(
      /DB_SSL_ROOT_CERT: required[\s\S]*REDIS_TLS_CA: required/,
    );
  });

  it('reads the certificate authority from a file, and refuses one that is not a certificate', () => {
    const ca = ['-----BEGIN CERTIFICATE-----', 'MIIB', '-----END CERTIFICATE-----', ''].join('\n');
    const env = loadWorkerEnv(
      { DB_SSL_ROOT_CERT_FILE: '/run/secrets/ca', REDIS_TLS_CA_FILE: '/run/secrets/ca' },
      read({ '/run/secrets/ca': ca }),
    );
    expect(env.DB_SSL_ROOT_CERT).toContain('BEGIN CERTIFICATE');
    expect(env.REDIS_TLS_CA).toContain('BEGIN CERTIFICATE');
    expect(() => loadWorkerEnv({ REDIS_TLS_CA: 'not a certificate' }, read({}))).toThrow(/REDIS_TLS_CA/);
  });

  it('only allows queue prefixes inside the Redis ACL pattern', () => {
    expect(() => loadWorkerEnv({ QUEUE_PREFIX: 'bull' }, read({}))).toThrow(/QUEUE_PREFIX/);
    expect(loadWorkerEnv({ QUEUE_PREFIX: 'pyth:test' }, read({})).QUEUE_PREFIX).toBe('pyth:test');
  });
});
