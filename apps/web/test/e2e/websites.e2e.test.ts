import { describe, expect, it } from 'vitest';

// Public websites through the web app (M3.5): the host decides the website,
// its content comes from the CMS, and website requests never touch the
// portal's session. Requests go straight to the web service with the host the
// gateway would forward (X-Forwarded-Host).

const WEB = 'http://web:3000';
const site = (host: string, path = '/', headers: Record<string, string> = {}) =>
  fetch(`${WEB}${path}`, {
    headers: { 'x-forwarded-host': `${host}:53000`, ...headers },
    redirect: 'manual',
  });

describe('school and group websites', () => {
  it("shows School A's published start page from the CMS, with the development banner", async () => {
    const response = await site('school-a.pythagoras.localhost');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('data-testid="cms-page"');
    expect(html).toContain('<h1>Welcome to School A</h1>');
    expect(html).toContain('This start page comes from the CMS.');
    expect(html).toContain('Payments use the development payment provider');
  });

  it('gives a website without CMS content a start page from the platform', async () => {
    const html = await (await site('pythagoras.localhost')).text();
    expect(html).toContain('data-testid="default-page"');
    expect(html).toMatch(/Pythagoras runs \d+ schools: School A, School B, School C/);
  });

  it('answers 404 for unknown pages and unknown hosts', async () => {
    expect((await site('school-a.pythagoras.localhost', '/no-such-page')).status).toBe(404);
    expect((await site('school-a.pythagoras.localhost', '/a/b')).status).toBe(404);
    expect((await site('unknown.pythagoras.localhost')).status).toBe(404);
  });

  it('never sets or reads the portal session on a website', async () => {
    const response = await site('school-a.pythagoras.localhost', '/', {
      cookie: 'pyth_session=forged',
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([]);
    // The portal sign-in route is not part of a website.
    expect((await site('school-a.pythagoras.localhost', '/auth/sign-in')).status).toBe(404);
  });

  it('keeps the website pages off the portal host, and the portal unchanged', async () => {
    const portal = { 'x-forwarded-host': 'portal.pythagoras.localhost:53000' };
    expect((await fetch(`${WEB}/sites`, { headers: portal })).status).toBe(404);
    const home = await (await fetch(`${WEB}/`, { headers: portal })).text();
    expect(home).toContain('data-testid="sign-in"');
  });
});
