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

  it('rejects an invalid port', () => {
    expect(() => load({ PORT: '70000' })).toThrow(/PORT/);
  });
});
