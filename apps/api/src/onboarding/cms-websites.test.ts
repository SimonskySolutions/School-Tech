import { describe, expect, it } from 'vitest';
import { CmsWebsitesClient } from './cms-websites';

function fakeCms(existing: boolean, createStatus = 201) {
  const calls: { method: string; url: string; auth: string | null; body: unknown }[] = [];
  const fetchImpl: typeof fetch = (url, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      method: init?.method ?? 'GET',
      url: url instanceof Request ? url.url : url.toString(),
      auth: headers.get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    });
    if ((init?.method ?? 'GET') === 'GET')
      return Promise.resolve(Response.json({ docs: existing ? [{ id: 1 }] : [] }));
    return Promise.resolve(new Response('{}', { status: createStatus }));
  };
  return { client: new CmsWebsitesClient('http://cms:3000', 'platform-key-value', fetchImpl), calls };
}

describe("adding a school's website to the CMS", () => {
  it('creates the tenant with the platform key when it is missing', async () => {
    const { client, calls } = fakeCms(false);
    expect(await client.ensureWebsite('school-d', 'School D')).toBe('created');
    expect(calls.map((call) => call.method)).toEqual(['GET', 'POST']);
    expect(calls[0]!.url).toContain('where[key][equals]=school-d');
    expect(calls[1]).toMatchObject({
      auth: 'users API-Key platform-key-value',
      body: { key: 'school-d', name: 'School D' },
    });
  });

  it('keeps an existing tenant', async () => {
    const { client, calls } = fakeCms(true);
    expect(await client.ensureWebsite('school-d', 'School D')).toBe('existing');
    expect(calls).toHaveLength(1);
  });

  it('reports a refusal instead of pretending', async () => {
    await expect(fakeCms(false, 403).client.ensureWebsite('school-d', 'School D')).rejects.toThrow('403');
  });
});
