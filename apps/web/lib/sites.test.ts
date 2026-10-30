import { describe, expect, it } from 'vitest';
import { defaultIntro, menu, pageSlug, websiteHost } from './sites';

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? null });
const PORTAL = 'portal.pythagoras.localhost:53000';

describe('websiteHost', () => {
  it('finds the website host from the gateway, without the port', () => {
    expect(
      websiteHost(
        headers({ 'x-forwarded-host': 'School-A.pythagoras.localhost:53000', host: 'web:3000' }),
        PORTAL,
      ),
    ).toBe('school-a.pythagoras.localhost');
    expect(websiteHost(headers({ host: 'school-a.example.bg' }), PORTAL)).toBe('school-a.example.bg');
  });

  it('keeps the portal and internal addresses on the portal', () => {
    expect(websiteHost(headers({ host: PORTAL }), PORTAL)).toBeNull();
    expect(websiteHost(headers({ host: 'web:3000' }), PORTAL)).toBeNull();
    expect(websiteHost(headers({ host: '127.0.0.1:3000' }), PORTAL)).toBeNull();
    expect(websiteHost(headers({}), PORTAL)).toBeNull();
  });
});

describe('pageSlug', () => {
  it('maps paths to CMS pages', () => {
    expect(pageSlug(undefined)).toBe('home');
    expect(pageSlug([])).toBe('home');
    expect(pageSlug(['lunch-menu'])).toBe('lunch-menu');
  });

  it('refuses deeper paths, odd characters and /home (the start page is /)', () => {
    expect(pageSlug(['a', 'b'])).toBeNull();
    expect(pageSlug(['../etc'])).toBeNull();
    expect(pageSlug(['home'])).toBeNull();
  });
});

describe('menu and default page', () => {
  it('lists pages with a menu position, in order, the start page as /', () => {
    expect(
      menu([
        { title: 'Lunch', slug: 'lunch', navOrder: 2, bodyHtml: null },
        { title: 'Welcome', slug: 'home', navOrder: 1, bodyHtml: null },
        { title: 'Hidden', slug: 'hidden', navOrder: null, bodyHtml: null },
      ]),
    ).toEqual([
      { href: '/', title: 'Welcome' },
      { href: '/lunch', title: 'Lunch' },
    ]);
  });

  it('introduces a website from the platform when it has no start page yet', () => {
    const site = {
      websiteId: 'w',
      code: 'pythagoras',
      name: 'Pythagoras',
      cmsKey: 'pythagoras',
      locale: 'bg',
    };
    expect(
      defaultIntro({
        ...site,
        purpose: 'group',
        schools: [
          { name: 'School A', kind: 'school' },
          { name: 'School B', kind: 'school' },
        ],
      }),
    ).toBe('Pythagoras runs 2 schools: School A, School B.');
    expect(defaultIntro({ ...site, name: 'School D', purpose: 'school', schools: [] })).toContain(
      'Welcome to School D',
    );
  });
});
