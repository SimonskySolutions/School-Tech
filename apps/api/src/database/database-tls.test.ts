import { describe, expect, it } from 'vitest';
import { databaseTls } from './database';

describe('database TLS (M8.4)', () => {
  it('verifies the server against the given authority', () => {
    expect(databaseTls('-----BEGIN CERTIFICATE-----')).toEqual({
      ca: '-----BEGIN CERTIFICATE-----',
      rejectUnauthorized: true,
    });
  });

  it('is off without one, as in development', () => {
    expect(databaseTls(undefined)).toBe(false);
  });
});
