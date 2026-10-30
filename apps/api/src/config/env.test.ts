import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

const load = (env: Record<string, string>, files: Record<string, string> = {}) =>
  loadEnv({
    env,
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`missing file ${path}`);
      return content;
    },
  });

describe('API configuration', () => {
  it('defaults to development with the development payment provider', () => {
    const env = load({});
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.PAYMENT_PROVIDER).toBe('development');
  });

  it('refuses Stripe without its keys', () => {
    expect(() => load({ PAYMENT_PROVIDER: 'stripe' })).toThrow(/STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET/);
  });

  it('accepts Stripe test keys, including from Docker secret files', () => {
    const env = load(
      {
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY_FILE: '/run/secrets/k',
        STRIPE_WEBHOOK_SECRET_FILE: '/run/secrets/w',
      },
      { '/run/secrets/k': 'sk_test_synthetic\n', '/run/secrets/w': 'whsec_synthetic\n' },
    );
    expect(env.STRIPE_SECRET_KEY).toBe('sk_test_synthetic');
    expect(env.STRIPE_WEBHOOK_SECRET).toBe('whsec_synthetic');
  });

  it('refuses a live Stripe key outside production', () => {
    expect(() =>
      load({ PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_x' }),
    ).toThrow(/live Stripe key/);
  });

  it('refuses the development payment provider in production', () => {
    expect(() => load({ NODE_ENV: 'production' })).toThrow(/development payment provider/);
  });

  it('never echoes secret values in errors', () => {
    try {
      load({
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_live_supersecret',
        STRIPE_WEBHOOK_SECRET: 'w',
      });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain('supersecret');
    }
  });

  it('uses the Compose services by default in development', () => {
    const env = load({});
    expect(env.DB_HOST).toBe('postgres');
    expect(env.DB_USER).toBe('pyth_api');
    expect(env.OIDC_ISSUER).toBe('http://localhost:58080/realms/pythagoras');
    expect(env.OIDC_ALLOWED_CLIENTS).toEqual(['pythagoras-web', 'pythagoras-dev-tests']);
  });

  it('reads the database password from a Docker secret file', () => {
    const env = load(
      { DB_PASSWORD_FILE: '/run/secrets/pg_api_password' },
      { '/run/secrets/pg_api_password': 'abc\n' },
    );
    expect(env.DB_PASSWORD).toBe('abc');
  });

  it('requires every connection value in production', () => {
    expect(() => load({ NODE_ENV: 'production', PAYMENT_PROVIDER: 'stripe' })).toThrow(
      /DB_HOST: required in production[\s\S]*DB_PASSWORD: required[\s\S]*OIDC_ISSUER: required/,
    );
  });

  it('refuses the development test client in production', () => {
    expect(() =>
      load({
        NODE_ENV: 'production',
        DB_HOST: 'db',
        DB_PASSWORD: 'x',
        OIDC_ISSUER: 'https://auth.example.test/realms/pythagoras',
        OIDC_JWKS_URL: 'https://auth.example.test/realms/pythagoras/protocol/openid-connect/certs',
        OIDC_ALLOWED_CLIENTS: 'pythagoras-web, pythagoras-dev-tests',
        PAYMENT_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_live_x',
        STRIPE_WEBHOOK_SECRET: 'whsec_x',
      }),
    ).toThrow(/pythagoras-dev-tests is a development-only client/);
  });

  it('refuses temporary passwords for new accounts in production', () => {
    expect(() => load({ NODE_ENV: 'production' })).toThrow(/ACCOUNT_SETUP: temporary passwords/);
    expect(() => load({ NODE_ENV: 'production', ACCOUNT_SETUP: 'email' })).not.toThrow(/ACCOUNT_SETUP/);
  });

  it('rejects an invalid port', () => {
    expect(() => load({ PORT: '70000' })).toThrow(/PORT/);
  });
});
