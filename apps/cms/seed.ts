import { readFileSync } from 'node:fs';
import type { Payload } from 'payload';

// DEVELOPMENT ONLY. A website for each seeded platform website (the keys match
// org.website.cms_tenant_key in db/seeds/development.sql), a published start
// page for each school, and one administrator who can sign in to the admin.
// Idempotent: it only adds what is missing.

const WEBSITES = [
  { key: 'pythagoras', name: 'Pythagoras' },
  { key: 'school-a', name: 'School A' },
  { key: 'school-b', name: 'School B' },
  { key: 'school-c', name: 'School C' },
];

const START_PAGES = [
  {
    website: 'school-a',
    title: 'Welcome to School A',
    text: 'School A is part of the Pythagoras group. This start page comes from the CMS.',
  },
  {
    website: 'school-b',
    title: 'Welcome to School B',
    text: 'School B is part of the Pythagoras group. Our team writes this page in the website editor.',
  },
  {
    website: 'school-c',
    title: 'Welcome to School C',
    text: 'School C is part of the Pythagoras group. Our team writes this page in the website editor.',
  },
];

const paragraph = (text: string) => ({
  type: 'paragraph',
  version: 1,
  direction: 'ltr' as const,
  format: '' as const,
  indent: 0,
  textFormat: 0,
  children: [{ type: 'text', version: 1, text, detail: 0, format: 0, mode: 'normal', style: '' }],
});

export async function seedDevelopment(payload: Payload): Promise<void> {
  const tenants = new Map<string, number | string>();
  for (const website of WEBSITES) {
    const found = await payload.find({
      collection: 'websites',
      where: { key: { equals: website.key } },
      limit: 1,
    });
    const existing = found.docs[0];
    tenants.set(
      website.key,
      existing ? existing.id : (await payload.create({ collection: 'websites', data: website })).id,
    );
  }

  for (const page of START_PAGES) {
    const home = await payload.find({
      collection: 'pages',
      where: { and: [{ slug: { equals: 'home' } }, { tenant: { equals: tenants.get(page.website) } }] },
      limit: 1,
      draft: true,
    });
    if (home.docs.length > 0) continue;
    await payload.create({
      collection: 'pages',
      draft: false,
      data: {
        title: page.title,
        slug: 'home',
        navOrder: 1,
        tenant: tenants.get(page.website),
        _status: 'published',
        body: {
          root: {
            type: 'root',
            version: 1,
            direction: 'ltr',
            format: '',
            indent: 0,
            children: [paragraph(page.text)],
          },
        },
      } as never,
    });
  }

  const users = await payload.count({ collection: 'users', where: { role: { not_equals: 'platform' } } });
  if (users.totalDocs === 0) {
    const passwordFile = process.env.CMS_DEV_EDITOR_PASSWORD_FILE;
    if (!passwordFile) return;
    await payload.create({
      collection: 'users',
      data: {
        email: 'editor@pythagoras.test',
        name: 'Development editor',
        role: 'admin',
        password: readFileSync(passwordFile, 'utf8').trim(),
      } as never,
    });
  }
}
