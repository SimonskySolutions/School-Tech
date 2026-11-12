import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { postgresAdapter } from '@payloadcms/db-postgres';
import { multiTenantPlugin } from '@payloadcms/plugin-multi-tenant';
import { lexicalEditor } from '@payloadcms/richtext-lexical';
import { buildConfig } from 'payload';
import { isAdmin, isPlatform } from './collections/access';
import { Pages } from './collections/pages';
import { Users } from './collections/users';
import { Websites } from './collections/websites';
import { migrations } from './migrations';
import { ensurePlatformAccount } from './platform';
import { seedDevelopment } from './seed';

// The website CMS (ADR 0017): its own database (pythagoras_cms) and role
// (pyth_cms); no access to the platform's data. Secrets come from Docker
// secret files (NAME_FILE), like every other service.

// `next build` loads this file too; secrets are never baked into a build, so
// during the build phase they are placeholders and the server reads the real
// ones when it starts.
const dirname = path.dirname(fileURLToPath(import.meta.url));

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
    components: {
      afterLogin: ['/components/sso-button#SsoButton'],
      graphics: { Logo: '/components/brand#Logo', Icon: '/components/brand#Icon' },
    },
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
      // M8.4: TLS verifying the server's certificate and name, when the
      // authority's certificate is given (production).
      ...(process.env.DB_SSL_ROOT_CERT_FILE
        ? { ssl: { ca: readFileSync(process.env.DB_SSL_ROOT_CERT_FILE, 'utf8'), rejectUnauthorized: true } }
        : {}),
    },
    // Development creates tables from the collections; production applies the
    // generated migrations in ./migrations when it starts (ADR 0033). After
    // changing a collection, generate one: `payload migrate:create <name>`.
    push: development,
    migrationDir: path.resolve(dirname, 'migrations'),
    prodMigrations: migrations,
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
