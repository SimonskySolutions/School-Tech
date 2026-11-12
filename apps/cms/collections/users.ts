import { APIError, type CollectionConfig } from 'payload';
import { passwordSignInAllowed } from '../sso/editor';
import { adminsOnly, isAdmin, selfOrAdmin } from './access';

/** People who edit the websites. They sign in with Keycloak (ADR 0019); the platform's service account uses a key. */
export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', group: 'Settings' },
  auth: {
    tokenExpiration: 8 * 60 * 60,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: { sameSite: 'Strict' },
    // Only the platform's service account uses a key; people sign in with a password.
    useAPIKey: true,
  },
  hooks: {
    // Password sign-in only on the development stack (ADR 0019).
    beforeLogin: [
      ({ user }) => {
        if (!passwordSignInAllowed(process.env)) {
          throw new APIError('Sign in with your Pythagoras account instead.', 403);
        }
        return user;
      },
    ],
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
      // Set at Keycloak sign-in; links this editor to their Pythagoras account.
      name: 'keycloakSubject',
      type: 'text',
      unique: true,
      index: true,
      admin: { readOnly: true, position: 'sidebar' },
      access: { create: () => false, update: () => false },
    },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'editor',
      options: [
        { label: 'Administrator (all websites, editors)', value: 'admin' },
        { label: 'Editor (assigned websites)', value: 'editor' },
        { label: 'Platform service (adds websites only)', value: 'platform' },
      ],
      // Only an administrator can make someone an administrator.
      access: { update: ({ req }) => isAdmin(req.user), create: ({ req }) => isAdmin(req.user) },
    },
  ],
};
