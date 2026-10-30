import 'server-only';
import { type SiteInfo } from '@pythagoras/shared';
import { type CmsPage } from './sites';

// Server-side reads for the public websites (M3.5): which website a host is
// (from the API) and its published pages (from the CMS). Both are public; no
// token is sent. The CMS returns published versions only to anonymous readers.

export type Lookup<T> = { kind: 'ok'; value: T } | { kind: 'missing' } | { kind: 'unavailable' };

const TIMEOUT_MS = 5000;

async function getJson(url: URL): Promise<{ status: number; body: unknown } | null> {
  try {
    const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: response.status, body: response.ok ? await response.json() : null };
  } catch {
    return null;
  }
}

export async function lookUpSite(apiUrl: string, host: string): Promise<Lookup<SiteInfo>> {
  const url = new URL('/sites/resolve', apiUrl);
  url.searchParams.set('host', host);
  const result = await getJson(url);
  if (!result) return { kind: 'unavailable' };
  if (result.status === 404 || result.status === 400) return { kind: 'missing' };
  if (result.status !== 200) return { kind: 'unavailable' };
  return { kind: 'ok', value: result.body as SiteInfo };
}

/** Every published page of one website: enough for the menu and the page asked for. */
export async function publishedPages(cmsUrl: string, cmsKey: string): Promise<Lookup<CmsPage[]>> {
  const url = new URL('/api/pages', cmsUrl);
  url.searchParams.set('where[tenant.key][equals]', cmsKey);
  url.searchParams.set('limit', '100');
  url.searchParams.set('depth', '0');
  url.searchParams.set('sort', 'navOrder');
  const result = await getJson(url);
  if (!result || result.status !== 200) return { kind: 'unavailable' };
  const docs = (result.body as { docs?: CmsPage[] }).docs ?? [];
  return {
    kind: 'ok',
    value: docs.map((doc) => ({
      title: doc.title,
      slug: doc.slug,
      navOrder: doc.navOrder ?? null,
      bodyHtml: doc.bodyHtml ?? null,
    })),
  };
}
