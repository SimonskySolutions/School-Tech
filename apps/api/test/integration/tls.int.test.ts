import { describe, expect, it } from 'vitest';

// The gateway's certificate check against the seeded domains (all verified for
// local development, all websites live).

const API = process.env.API_URL ?? 'http://api:3000';
const ask = (domain: string) => fetch(`${API}/internal/tls/allowed?domain=${encodeURIComponent(domain)}`);

describe('GET /internal/tls/allowed', () => {
  it.each(['portal.pythagoras.localhost', 'school-a.pythagoras.localhost', 'SCHOOL-B.Pythagoras.Localhost'])(
    'allows the verified domain %s',
    async (domain) => {
      expect((await ask(domain)).status).toBe(200);
    },
  );

  it('refuses a domain we do not own', async () => {
    expect((await ask('elsewhere.example.test')).status).toBe(404);
  });

  it('refuses a sub-domain that is not registered', async () => {
    expect((await ask('evil.school-a.pythagoras.localhost')).status).toBe(404);
  });

  it.each(['', 'not a host', "x'; DROP TABLE org.school; --", 'a'.repeat(300)])(
    'rejects malformed input %j',
    async (domain) => {
      expect((await ask(domain)).status).toBe(400);
    },
  );
});
