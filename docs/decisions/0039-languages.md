# 0039 Languages: Bulgarian and English, each person's own choice

Date: 2026-11-03 · Status: Accepted

## Context

The group's owner asked for every user to be able to switch the system to Bulgarian, with an EN / BG switch in the top bar. Until now every word of the portal was written in English in the page code. Several pieces are involved:

| Piece | Today |
| --- | --- |
| The portal (`apps/web`) | About 13,000 lines; English text written in the page code, with no translation layer |
| The sign-in pages (Keycloak) | The realm already offers `bg` and `en`, default `bg`; the Pythagoras theme has no texts of its own |
| E-mails (the worker's templates, Keycloak's e-mails) | English |
| School websites | Whatever editors write in the CMS; not the platform's words |

`people.person.preferred_locale` has existed since M0 for any locale. No release has written it.

Options considered:

| Option | Verdict |
| --- | --- |
| A translation library (next-intl, i18next) with JSON catalogs | Another dependency and its routing conventions, for two languages; JSON catalogs cannot check a missing key at build time, or text that takes values |
| A language in the address (`/bg/...`) | Every link, redirect and test changes; a person's choice still has to be remembered |
| **Typed catalogs in TypeScript, the language chosen per request** | **Chosen**: `lib/i18n/en.ts` is the source; `bg.ts` must have the same shape, so the type check fails on a missing key. A text that takes values is a function, so each language places them as its grammar needs |

## Decision

**The languages are English and Bulgarian** (`LANGUAGES` in `@pythagoras/shared`). English is the default, as before.

**Each person's choice is theirs**:
- It is kept in `people.person.preferred_locale`, now limited to `bg` or `en`; NULL lets the browser decide.
- The person sets it through the update policy they already have on their own row. `PUT /me/language` takes `bg`, `en` or `null`, and `GET /me` returns `person.language`.

**Which language a page is in** (`chooseLanguage`, `lib/i18n/messages.ts`), first match wins:
1. the signed-in person's own choice;
2. this browser's last choice (the `pythagoras_language` cookie, a year);
3. the browser's `Accept-Language`, by its weights;
4. English.

`currentLanguage()` (`lib/server.ts`) decides once per request. `/me` is now also asked once per request (`myself`, cached), however many parts of the page need it. The page's `<html lang>` follows the language.

**The switch:**
- **EN / BG** in the top bar, to the left of the notifications bell, and in the corner of the signed-out pages.
- It is a form, so it works before any script has loaded. `POST /language` checks the origin, sets the cookie, saves the choice for the person when signed in, and returns to the same page (only paths on the portal).
- Signing in brings a saved choice back to the browser. A choice made before signing in becomes the person's own, when they have none.

**Formatting:** dates and numbers follow the language (`localeOf`: `bg-BG` or `en-GB`), starting with the start page's date. The shared `formatMoney` already takes a locale; each page passes the language's locale as it is translated (M9.2, M9.3).

**The words** are grouped by where they appear, in two files a reviewer can correct without touching code. Role names are translated by role code; a role without words keeps the database's name.

**Steps (M9):**

| Step | Scope |
| --- | --- |
| M9.1 | The foundation, the switch, and the shell: menu, top bar, start page, error and not-found pages, the banner |
| M9.2 | The family pages |
| M9.3 | The staff pages |
| M9.4 | The sign-in pages (`ui_locales` passed to Keycloak) and every e-mail in the recipient's language |
| M9.5 | The checks across all of it |

**School websites keep their editors' language.** The CMS's own screens are not included.

## Consequences

- Until M9.2 and M9.3 are done, a person who chooses Bulgarian sees the frame and the start page in Bulgarian and the other pages still in English.
- The Bulgarian texts were written by the developer. A native speaker at the group should review `apps/web/lib/i18n/bg.ts` before families see it.
- A third language would mean:
  - a catalog of the same shape;
  - an entry in `LANGUAGES`;
  - a migration widening the check on `preferred_locale`.
- Tightening the check on `preferred_locale` is safe for a rollback: no earlier release writes the column.
- The catalogs are bundled into the browser only for the few client components (the switch and the error page). The rest stays on the server.
