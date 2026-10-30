import type { Access, Where } from 'payload';

// Who may do what in the website CMS (ADR 0017). Pure functions of the signed
// in editor, so the rules are unit-tested. Anyone may read published pages:
// they are the public websites. Everything else needs an editor; managing
// editors and websites needs an administrator. Which websites an editor may
// change is decided by the multi-tenant plugin.

export type Role = 'admin' | 'editor';

interface Editor {
  role?: Role | null;
}

const editorOf = (user: unknown): Editor | null =>
  user && typeof user === 'object' ? (user as Editor) : null;

export const isAdmin = (user: unknown): boolean => editorOf(user)?.role === 'admin';

export const signedIn: Access = ({ req }) => Boolean(req.user);

export const adminsOnly: Access = ({ req }) => isAdmin(req.user);

/** The public sees published versions only; editors also see drafts. */
export const publishedOrEditor: Access = ({ req }) =>
  req.user ? true : ({ _status: { equals: 'published' } } satisfies Where);

/** An editor may read and update themselves; administrators everyone. */
export const selfOrAdmin: Access = ({ req }) => {
  if (isAdmin(req.user)) return true;
  const id = (req.user as { id?: number | string } | null)?.id;
  return id === undefined ? false : ({ id: { equals: id } } satisfies Where);
};
