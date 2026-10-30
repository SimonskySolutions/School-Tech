// Who may edit websites, from the Keycloak ID token (ADR 0019). Pure, so the
// rules are unit-tested: Keycloak's client roles decide whether someone is a
// CMS administrator, an editor, or nobody; the CMS decides which websites.

export type EditorRole = 'admin' | 'editor';

export interface EditorIdentity {
  subject: string;
  email: string;
  name: string;
  role: EditorRole;
}

export class NotAnEditor extends Error {}

/** The editor described by verified ID-token claims, or NotAnEditor. */
export function editorFromClaims(claims: Record<string, unknown>): EditorIdentity {
  const roles = Array.isArray(claims.cms_roles)
    ? claims.cms_roles.filter((r): r is string => typeof r === 'string')
    : [];
  const role: EditorRole | null = roles.includes('cms-admin')
    ? 'admin'
    : roles.includes('cms-editor')
      ? 'editor'
      : null;
  if (!role) throw new NotAnEditor('this account may not edit the websites');
  const subject = typeof claims.sub === 'string' ? claims.sub : '';
  const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
  if (!subject || !email) throw new NotAnEditor('the account has no subject or e-mail address');
  if (claims.email_verified === false) throw new NotAnEditor('the account e-mail address is not verified');
  const name =
    (typeof claims.name === 'string' && claims.name.trim()) ||
    [claims.given_name, claims.family_name].filter((part) => typeof part === 'string' && part).join(' ') ||
    email;
  return { subject, email, name, role };
}

/** Password sign-in is for the development stack only (ADR 0019). */
export const passwordSignInAllowed = (env: Readonly<Record<string, string | undefined>>) =>
  env.CMS_PASSWORD_LOGIN === 'true';
