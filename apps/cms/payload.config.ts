import { readFileSync } from 'node:fs';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import { isAdmin, isPlatform } from './collections/access';
import { Pages } from './collections/pages';
import { Users } from './collections/users';
import { Websites } from './collections/websites';
import { ensurePlatformAccount } from './platform';
import { seedDevelopment } from './seed';

// The website CMS (ADR 0017): its own database (pythagoras_cms) and role
// (pyth_cms); no access to the platform's data. Secrets come from Docker
// secret files (NAME_FILE), like every other service.

// `next build` loads this file too; secrets are never baked into a build, so
// during the build phase they are placeholders and the server reads the real
// ones when it starts.
const building = process.env.NEXT_PHASE === 'phase-production-build';

function setting(name: string, fallback?: string): string {
  const file = process.env[`${name}_FILE`];
  const value = process.env[name] ?? (file ? readFileSync(file, 'utf8').trim() : fallback);
  if (value) return value;
  if (building) return `build-time-placeholder-${name.toLowerCase()}`;
  throw new Error(`${name} (or ${name}_FILE) is required`);
}

const development = process.env.NODE_ENV !== 'production';

export default buildConfig({
  secret: setting('PAYLOAD_SECRET'),
  serverURL: process.env.CMS_PUBLIC_URL ?? '',
  admin: {
    user: Users.slug,
    meta: { titleSuffix: ' · Pythagoras websites' },
  },
  collections: [Users, Websites, Pages],
  editor: lexicalEditor(),
  db: postgresAdapter({
    pool: {
      host: setting('DB_HOST', 'postgres'),
      port: Number(setting('DB_PORT', '5432')),
      database: setting('DB_NAME', 'pythagoras_cms'),
      user: setting('DB_USER', 'pyth_cms'),
      password: setting('DB_PASSWORD'),
      max: 10,
    },
    // Development creates tables from the collections; production applies
    // generated migrations as a release step (M8).
    push: development,
  }),
  plugins: [
    multiTenantPlugin({
      tenantsSlug: 'websites',
      collections: { pages: {} },
      // The platform's account must see every website to add a new one; its own
      // rules still keep it from content and drafts.
      userHasAccessToAllTenants: (user) => isAdmin(user) || isPlatform(user),
    }),
  ],
  graphQL: { disable: true },
  telemetry: false,
  typescript: { autoGenerate: false },
  onInit: async (payload) => {
    await ensurePlatformAccount(payload);
    if (development) await seedDevelopment(payload);
  },
});
