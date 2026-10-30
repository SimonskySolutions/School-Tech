import { type SiteInfo } from '@pythagoras/shared';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, secret } from './helpers';

// Websites (M3.5, ADR 0017) against the running stack: the API's host look-up,
// the CMS's publishing rule (drafts never public), editors only for writes,
// and the CMS kept in its own database.

const CMS = process.env.CMS_URL ?? 'http://cms:3000';
const run = Date.now().toString(36);
let editorToken: string;
let pageId: string | number | undefined;

async function cms(path: string, init: RequestInit = {}, token?: string) {
  const response = await fetch(`${CMS}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `JWT ${token}` } : {}),
    },
  });
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

const publicPages = async (key: string) =>
  (
    (await cms(`/api/pages?where[tenant.key][equals]=${key}&limit=100&depth=0`)).body as {
      docs: { slug: string; title: string; _status: string }[];
    }
  ).docs;

beforeAll(async () => {
  const login = await cms('/api/users/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'editor@pythagoras.test', password: secret('keycloak_dev_user_password') }),
  });
  expect(login.status).toBe(200);
  editorToken = login.body.token as string;
});

afterAll(async () => {
  if (pageId !== undefined) await cms(`/api/pages/${pageId}`, { method: 'DELETE' }, editorToken);
});

describe('which website a host is', () => {
  it('names the website, its CMS key and its schools', async () => {
    const response = await fetch(`${API}/sites/resolve?host=School-A.pythagoras.localhost:53000`);
    expect(response.status).toBe(200);
    expect((await response.json()) as SiteInfo).toMatchObject({
      code: 'school-a',
      name: 'School A',
      purpose: 'school',
      cmsKey: 'school-a',
      schools: [{ name: 'School A', kind: 'school' }],
    });
  });

  it('answers 404 for hosts that are not a verified domain of a live website', async () => {
    expect((await fetch(`${API}/sites/resolve?host=unknown.pythagoras.localhost`)).status).toBe(404);
    expect((await fetch(`${API}/sites/resolve?host=not a host`)).status).toBe(400);
  });
});

describe('publishing in the CMS', () => {
  it('keeps a draft out of the public website until it is published', async () => {
    const websites = (await cms('/api/websites?where[key][equals]=school-b&limit=1')).body as {
      docs: { id: number | string }[];
    };
    const tenant = websites.docs[0]!.id;
    const slug = `test-${run}`;
    const draft = await cms(
      '/api/pages?draft=true',
      { method: 'POST', body: JSON.stringify({ title: `Draft ${run}`, slug, tenant, _status: 'draft' }) },
      editorToken,
    );
    expect(draft.status).toBe(201);
    pageId = (draft.body.doc as { id: number | string }).id;
    expect((await publicPages('school-b')).map((page) => page.slug)).not.toContain(slug);

    const published = await cms(
      `/api/pages/${pageId}`,
      { method: 'PATCH', body: JSON.stringify({ _status: 'published' }) },
      editorToken,
    );
    expect(published.status).toBe(200);
    expect((await publicPages('school-b')).map((page) => page.slug)).toContain(slug);
  });

  it('lets nobody but an editor write, and hides editor accounts', async () => {
    expect(
      (await cms('/api/pages', { method: 'POST', body: JSON.stringify({ title: 'x', slug: 'x' }) })).status,
    ).toBe(403);
    expect((await cms('/api/users')).status).toBe(403);
    expect(
      (await cms('/api/websites', { method: 'POST', body: JSON.stringify({ name: 'x', key: 'x' }) })).status,
    ).toBe(403);
  });
});

describe('separate databases', () => {
  const connect = (database: string, user: string, password: string) =>
    new Client({ host: 'postgres', database, user, password, connectionTimeoutMillis: 3000 }).connect();

  it('the CMS role cannot reach the platform database', async () => {
    await expect(connect('pythagoras', 'pyth_cms', secret('pg_cms_password'))).rejects.toThrow(
      /pg_hba|no pg_hba|not permitted|rejected/i,
    );
  });

  it('the platform roles cannot reach the CMS database', async () => {
    await expect(connect('pythagoras_cms', 'pyth_api', secret('pg_api_password'))).rejects.toThrow(
      /pg_hba|no pg_hba|not permitted|rejected/i,
    );
  });
});
