import type { Access } from 'payload';
import { describe, expect, it } from 'vitest';
import {
  adminOrPlatform,
  adminsOnly,
  contentEditor,
  isAdmin,
  publishedOrEditor,
  selfOrAdmin,
  signedIn,
} from './access';
import { SLUG } from './pages';

const as = (user: object | null) => ({ req: { user } }) as unknown as Parameters<Access>[0];
const editor = { id: 7, role: 'editor' };
const admin = { id: 1, role: 'admin' };

describe('website CMS access', () => {
  it('shows the public published pages only, and editors drafts too', () => {
    expect(publishedOrEditor(as(null))).toEqual({ _status: { equals: 'published' } });
    expect(publishedOrEditor(as(editor))).toBe(true);
  });

  it('needs a signed-in editor to change pages', () => {
    expect(signedIn(as(null))).toBe(false);
    expect(signedIn(as(editor))).toBe(true);
  });

  it('keeps editors and websites to administrators', () => {
    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(editor)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(adminsOnly(as(editor))).toBe(false);
    expect(adminsOnly(as(admin))).toBe(true);
  });

  it("lets the platform's service account add websites but never edit content", () => {
    const platform = { id: 2, role: 'platform' };
    expect(adminOrPlatform(as(platform))).toBe(true);
    expect(adminOrPlatform(as(editor))).toBe(false);
    expect(contentEditor(as(platform))).toBe(false);
    expect(contentEditor(as(editor))).toBe(true);
    expect(contentEditor(as(null))).toBe(false);
    expect(publishedOrEditor(as(platform))).toEqual({ _status: { equals: 'published' } });
  });

  it('lets an editor see only their own account', () => {
    expect(selfOrAdmin(as(editor))).toEqual({ id: { equals: 7 } });
    expect(selfOrAdmin(as(admin))).toBe(true);
    expect(selfOrAdmin(as(null))).toBe(false);
  });

  it('accepts page addresses made of lower-case words', () => {
    expect(SLUG.test('lunch-menu')).toBe(true);
    expect(SLUG.test('Lunch')).toBe(false);
    expect(SLUG.test('a/b')).toBe(false);
    expect(SLUG.test('-x')).toBe(false);
  });
});
