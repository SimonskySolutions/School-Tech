import type { CollectionConfig } from 'payload';
import { adminsOnly } from './access';

/**
 * One tenant per website. `key` is the platform's org.website.cms_tenant_key,
 * which is how the web app finds a website's pages (ADR 0017).
 */
export const Websites: CollectionConfig = {
  slug: 'websites',
  admin: { useAsTitle: 'name', group: 'Settings' },
  access: {
    // A website's name and key are public, like the website itself.
    read: () => true,
    create: adminsOnly,
    update: adminsOnly,
    delete: adminsOnly,
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'key',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: { description: 'The website code in the platform, for example school-a.' },
      validate: (value: unknown) =>
        typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,62}$/.test(value)
          ? true
          : 'Lower-case letters, digits and dashes, 2-63 characters.',
    },
  ],
};
