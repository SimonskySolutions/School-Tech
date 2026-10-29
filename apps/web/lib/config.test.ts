import { describe, expect, it } from 'vitest';
import { loadWebConfig } from './config';

const SECRET = 'a'.repeat(64);
const files: Record<string, string> = {
  '/run/secrets/client': 'client-secret-0123456789\n',
  '/run/secrets/session': `${SECRET}\n`,
};
const read = (path: string) => {
  const content = files[path];
  if (content === undefined) throw new Error(`missing ${path}`);
  return content;
};

describe('web configuration', () => {
  it('reads secrets from Docker secret files and uses development defaults', () => {
    const config = loadWebConfig(
      { OIDC_CLIENT_SECRET_FILE: '/run/secrets/client', SESSION_SECRET_FILE: '/run/secrets/session' },
      read,
    );
    expect(config.OIDC_CLIENT_SECRET).toBe('client-secret-0123456789');
    expect(config.APP_URL).toBe('http://localhost:53000');
    expect(config.secureCookies).toBe(false);
  });

  it('refuses to start without its secrets', () => {
    expect(() => loadWebConfig({}, read)).toThrow(/OIDC_CLIENT_SECRET[\s\S]*SESSION_SECRET/);
  });

  it('requires HTTPS in production, which also makes cookies Secure', () => {
    const base = { NODE_ENV: 'production', OIDC_CLIENT_SECRET: 'x'.repeat(20), SESSION_SECRET: SECRET };
    expect(() => loadWebConfig(base, read)).toThrow(/APP_URL: must use https/);
    const config = loadWebConfig(
      {
        ...base,
        APP_URL: 'https://portal.example.test',
        OIDC_ISSUER: 'https://auth.example.test/realms/pythagoras',
      },
      read,
    );
    expect(config.secureCookies).toBe(true);
  });
});
