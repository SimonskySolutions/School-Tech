import { type MeResponse, type PersonId, type SchoolId } from '@pythagoras/shared';
import { describe, expect, it } from 'vitest';
import { buildHome } from '../home';
import { navigation } from '../navigation';
import { bg } from './bg';
import { en } from './en';
import { chooseLanguage, fromAcceptLanguage, localeOf, messages } from './messages';

// The languages of the portal (M9.1, ADR 0039).

/** Every key of a catalog, nested ones as "a.b", with the kind of value it holds. */
function shape(value: unknown, prefix = ''): string[] {
  if (typeof value === 'function') return [`${prefix} (text with values)`];
  if (typeof value === 'string') return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, entry]) => shape(entry, prefix ? `${prefix}.${key}` : key))
    .sort();
}

/** Every text of a catalog, functions given sample values. */
function texts(value: unknown): string[] {
  if (typeof value === 'function') return [(value as (...args: string[]) => string)('X', 'Y')];
  if (typeof value === 'string') return [value];
  return Object.values(value as Record<string, unknown>).flatMap(texts);
}

describe('catalogs', () => {
  it('have the same keys in Bulgarian as in English, texts with values included', () => {
    expect(shape(bg)).toEqual(shape(en));
  });

  it('have no empty text, and Bulgarian is written in Cyrillic', () => {
    expect(texts(en).every((text) => text.trim().length > 0)).toBe(true);
    expect(texts(bg).every((text) => text.trim().length > 0)).toBe(true);
    // Names of languages and the brand's letters aside, a Bulgarian text has Cyrillic in it.
    const latinOnly = texts(bg).filter((text) => !/[Ѐ-ӿ]/.test(text) && !/^(English|X|Y|X, Y)$/.test(text));
    expect(latinOnly).toEqual([]);
  });

  it('put the values where each language needs them', () => {
    expect(en.home.classLabel('3A')).toBe('class 3A');
    expect(bg.home.classLabel('3A')).toBe('3A клас');
    expect(bg.home.greeting('Анна')).toBe('Здравейте, Анна');
  });
});

describe('choosing the language', () => {
  it('follows the person’s own choice first, then this browser’s, then what the browser asks for', () => {
    expect(chooseLanguage({ saved: 'bg', cookie: 'en', acceptLanguage: 'en' })).toBe('bg');
    expect(chooseLanguage({ saved: null, cookie: 'bg', acceptLanguage: 'en' })).toBe('bg');
    expect(chooseLanguage({ saved: null, cookie: null, acceptLanguage: 'bg-BG,bg;q=0.9,en;q=0.8' })).toBe(
      'bg',
    );
  });

  it('is English when nothing says otherwise, or when what is said is not a language it speaks', () => {
    expect(chooseLanguage({})).toBe('en');
    expect(chooseLanguage({ cookie: 'de', acceptLanguage: 'de-DE,fr;q=0.5' })).toBe('en');
    expect(chooseLanguage({ cookie: 'BG' })).toBe('en');
  });

  it('reads the browser’s list by its weights, skipping what it cannot speak', () => {
    expect(fromAcceptLanguage('de-DE, en;q=0.4, bg;q=0.7')).toBe('bg');
    expect(fromAcceptLanguage('en-US,en;q=0.9,bg;q=0.8')).toBe('en');
    expect(fromAcceptLanguage('bg;q=0, en;q=0.1')).toBe('en');
    expect(fromAcceptLanguage('*')).toBeNull();
    expect(fromAcceptLanguage('')).toBeNull();
    expect(fromAcceptLanguage(undefined)).toBeNull();
  });

  it('formats dates and numbers the way each language does', () => {
    expect(localeOf('bg')).toBe('bg-BG');
    expect(localeOf('en')).toBe('en-GB');
  });
});

describe('the portal’s frame in Bulgarian', () => {
  const principal: MeResponse = {
    person: {
      id: 'petar' as PersonId,
      givenName: 'Петър',
      familyName: 'Тест',
      preferredName: null,
      email: null,
      language: 'bg',
    },
    roles: [
      {
        code: 'principal',
        name: 'Principal',
        scope: 'school',
        school: { id: 'a' as SchoolId, name: 'School A' },
      },
    ],
    children: [],
  };

  it('greets, names the role and labels the menu in Bulgarian', () => {
    const view = buildHome(principal, [], messages('bg'));
    expect(view.greeting).toBe('Здравейте, Петър');
    expect(view.schoolRoles[0]?.role).toBe('Директор');
    const groups = navigation(view, messages('bg'));
    expect(groups[0]?.label).toBe('Общ преглед');
    expect(groups[0]?.items.map((item) => item.label)).toContain('Начало');
    expect(groups.map((group) => group.label)).toContain('Училищен живот');
  });

  it('keeps the database’s name for a role it has no words for', () => {
    const view = buildHome(
      { ...principal, roles: [{ code: 'librarian', name: 'Librarian', scope: 'group', school: null }] },
      [],
      messages('bg'),
    );
    expect(view.groupRoles).toEqual(['Librarian']);
  });
});
