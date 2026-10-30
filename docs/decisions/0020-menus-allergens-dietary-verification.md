# 0020 Lunch menus, allergens and verified dietary needs

Date: 2026-10-30 · Status: Accepted

## Context

The brief asks for lunch menus and dietary restrictions (M4.1). Until now a child's dietary need was free text that only the seed could write, and the kitchen list had no menu to compare it with. A parent must be able to record a need, staff must be able to rely on it, and the kitchen must notice when a child is booked on a lunch that contains their allergen. ADR 0006 also requires an access-log row for every read of health data, which the kitchen list (M2.6) did not yet write.

## Decision

- **Allergens are codes, the 14 of EU Regulation 1169/2011, Annex II** (`catalog.allergen_codes()`: gluten, crustaceans, eggs, fish, peanuts, soybeans, milk, nuts, celery, mustard, sesame, sulphites, lupin, molluscs). Dishes and dietary needs both store them (`text[]`, checked against the list), so matching is exact. Anything else (kiwi, a medical diet) stays in the need's description and is shown to the kitchen as text.
- **A menu belongs to one lunch session** (`scheduling.menu_dish`: an offering on one day; up to 12 dishes, each with a course, a name and its allergens). A trigger refuses dishes on anything but lunch. Publishing needs the new permission `menus.manage` (School Life coordinator, principal, kitchen) at the school; reading follows the session, so parents see the menu of every lunch day they can book. Saving a day replaces its menu.
- **Verification is decided by the database, not the caller.** A trigger on `sensitive.dietary_requirement` sets `verified_by_person_id` and `verified_at`: staff with `sensitive.dietary.manage` who record, change or verify a need verify it as themselves, now; a guardian's new need, or any change by a guardian, is unverified; a guardian cannot set or forge a verification (`42501`). So a verified need can never change without staff seeing it again.
- **Parents end needs, they do not delete them**, except that the guardian who recorded a need may take it back while it is unverified. Ending sets the last day to today, so today's lunch is still prepared with it and the history stays in the database and the audit log.
- **Warnings are computed when read.** The kitchen list compares each booked child's declared allergens with the menu of the lunch they are booked on and lists those children first, as alerts. The booking page shows the parent the same warning for their own child.
- **Every read of dietary rows is logged** in `audit.access_log`: one row per child per read (`sensitive.dietary_requirement:kitchen`, `:review`, `:family`), with who read and when, never the data.

## Consequences

- The kitchen and School Life see "not yet verified" next to a need until someone checks it with the family. What evidence a school asks for (for example a doctor's letter for a medical diet) is a school procedure, not enforced by the platform.
- Changing a menu after parents booked takes effect on the kitchen list at once; parents are not notified of menu changes yet (notifications, M7).
- The lawful basis and retention for children's health data still need the data protection officer's approval before production (ADR 0006); nothing here changes that.
