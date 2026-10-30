import type { CollectionConfig } from 'payload';
import { adminsOnly, isAdmin, selfOrAdmin } from './access';

/** People who edit the websites. Sign-in through Keycloak is an open item (ADR 0017). */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', group: 'Settings' },
  auth: {
    tokenExpiration: 8 * 60 * 60,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: { sameSite: 'Strict' },
  },
  access: {
    read: selfOrAdmin,
    create: adminsOnly,
    update: selfOrAdmin,
    delete: adminsOnly,
    admin: ({ req }) => Boolean(req.user),
  },
  fields: [
    { name: 'name', type: 'text', required: true },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: [
        { label: 'Administrator (all websites, editors)', value: 'admin' },
        { label: 'Editor (assigned websites)', value: 'editor' },
      ],
      // Only an administrator can make someone an administrator.
      access: { update: ({ req }) => isAdmin(req.user), create: ({ req }) => isAdmin(req.user) },
    },
  ],
};
