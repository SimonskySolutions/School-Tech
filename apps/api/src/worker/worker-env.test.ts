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
    });
  });

  it('requires hosts and passwords in production', () => {
    expect(() => loadWorkerEnv({ NODE_ENV: 'production' }, read({}))).toThrow(
      /DB_HOST: required[\s\S]*DB_PASSWORD[\s\S]*REDIS_HOST[\s\S]*REDIS_PASSWORD/,
    );
  });

  it('only allows queue prefixes inside the Redis ACL pattern', () => {
    expect(() => loadWorkerEnv({ QUEUE_PREFIX: 'bull' }, read({}))).toThrow(/QUEUE_PREFIX/);
    expect(loadWorkerEnv({ QUEUE_PREFIX: 'pyth:test' }, read({})).QUEUE_PREFIX).toBe('pyth:test');
  });
});
