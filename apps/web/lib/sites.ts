import { type SiteInfo } from '@pythagoras/shared';

// Public school and group websites (M3.5, ADR 0017). The same web app serves
// the family portal and every website; the host name decides which. These
// rules are plain functions so they are unit-tested.

/** Header the proxy sets on a rewritten website request: the host it was for. */
export const SITE_HOST_HEADER = 'x-pythagoras-site-host';

/** The internal path website requests are rewritten to. Never reachable on the portal host. */
export const SITE_PREFIX = '/sites';

const IP = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\])(:\d+)?$/i;

/**
 * Which host a request is for: the gateway's X-Forwarded-Host, else Host.
 * Returns null for the portal and for internal addresses (no dot, an IP),
 * which always get the portal.
 */
export function websiteHost(
  headers: { get(name: string): string | null },
  portalHost: string,
): string | null {
  const raw = (headers.get('x-forwarded-host') ?? headers.get('host') ?? '')
    .split(',')[0]!
    .trim()
    .toLowerCase();
  if (!raw || raw === portalHost.toLowerCase()) return null;
  const name = raw.replace(/:\d+$/, '');
  if (!name.includes('.') || IP.test(raw)) return null;
  return name;
}

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The CMS page a website path shows: "/" is "home", "/about" is "about"; anything deeper is not a page. */
export function pageSlug(path: readonly string[] | undefined): string | null {
  if (!path || path.length === 0) return 'home';
  if (path.length !== 1) return null;
  const slug = decodeURIComponent(path[0]!).toLowerCase();
  return slug !== 'home' && SLUG.test(slug) && slug.length <= 80 ? slug : null;
}

export interface CmsPage {
  title: string;
  slug: string;
  navOrder: number | null;
  bodyHtml: string | null;
}

/** Menu entries: pages with a menu position, in that order, the start page first. */
export function menu(pages: readonly CmsPage[]): { href: string; title: string }[] {
  return pages
    .filter((page) => page.navOrder !== null && page.navOrder !== undefined)
    .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0) || a.title.localeCompare(b.title))
    .map((page) => ({ href: page.slug === 'home' ? '/' : `/${page.slug}`, title: page.title }));
}

/** What a website without its own start page in the CMS shows, from the platform's data. */
export function defaultIntro(site: SiteInfo): string {
  const schools = site.schools.map((school) => school.name);
  if (site.purpose === 'group' && schools.length > 0) {
    return `${site.name} runs ${schools.length === 1 ? 'one school' : `${schools.length} schools`}: ${schools.join(', ')}.`;
  }
  return `Welcome to ${site.name}. More about the school will appear here soon.`;
}
