import { describe, expect, it } from 'vitest';
import { editorFromClaims, NotAnEditor, passwordSignInAllowed } from './editor';

const claims = (overrides: Record<string, unknown> = {}) => ({
  sub: 'kc-1',
  email: 'Admin@Pythagoras.test',
  email_verified: true,
  given_name: 'Georgi',
  family_name: 'Dimitrov',
  cms_roles: ['cms-admin'],
  ...overrides,
});

describe('who may edit the websites', () => {
  it('makes a CMS administrator or editor from the Keycloak client roles', () => {
    expect(editorFromClaims(claims())).toEqual({
      subject: 'kc-1',
      email: 'admin@pythagoras.test',
      name: 'Georgi Dimitrov',
      role: 'admin',
    });
    expect(editorFromClaims(claims({ cms_roles: ['cms-editor'] })).role).toBe('editor');
    expect(editorFromClaims(claims({ cms_roles: ['cms-editor', 'cms-admin'] })).role).toBe('admin');
  });

  it('refuses accounts without a CMS role, an e-mail or a verified address', () => {
    expect(() => editorFromClaims(claims({ cms_roles: undefined }))).toThrow(NotAnEditor);
    expect(() => editorFromClaims(claims({ cms_roles: ['something-else'] }))).toThrow(NotAnEditor);
    expect(() => editorFromClaims(claims({ email: undefined }))).toThrow(NotAnEditor);
    expect(() => editorFromClaims(claims({ email_verified: false }))).toThrow(NotAnEditor);
  });

  it('allows password sign-in only when the development stack says so', () => {
    expect(passwordSignInAllowed({ CMS_PASSWORD_LOGIN: 'true' })).toBe(true);
    expect(passwordSignInAllowed({})).toBe(false);
    expect(passwordSignInAllowed({ CMS_PASSWORD_LOGIN: 'yes' })).toBe(false);
  });
});
