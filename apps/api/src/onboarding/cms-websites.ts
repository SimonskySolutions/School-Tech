// Gives a school's website its space (tenant) in the CMS (M3.5, ADR 0017),
// as the CMS's platform service account, which may add websites and nothing
// else. Idempotent: an existing tenant with the same key is kept.

export const CMS_WEBSITES = Symbol('CMS_WEBSITES');

export type TenantOutcome = 'created' | 'existing';

export interface CmsWebsites {
  ensureWebsite(key: string, name: string): Promise<TenantOutcome>;
}

export class CmsWebsitesClient implements CmsWebsites {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private call(path: string, init: RequestInit = {}) {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        authorization: `users API-Key ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });
  }

  async ensureWebsite(key: string, name: string): Promise<TenantOutcome> {
    const found = await this.call(
      `/api/websites?where[key][equals]=${encodeURIComponent(key)}&limit=1&depth=0`,
    );
    if (!found.ok) throw new Error(`the CMS answered ${found.status} looking up website ${key}`);
    if (((await found.json()) as { docs: unknown[] }).docs.length > 0) return 'existing';
    const created = await this.call('/api/websites', { method: 'POST', body: JSON.stringify({ key, name }) });
    if (created.status !== 201) throw new Error(`the CMS answered ${created.status} adding website ${key}`);
    return 'created';
  }
}
