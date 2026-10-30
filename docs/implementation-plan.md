# Implementation plan

Last updated: 2026-10-30. Current milestone: **M2 complete** (CI green on GitHub for every M2 commit, runs #5–#12); **M3 in progress**: onboarding (M3.1), sign-in accounts (M3.2), students and families (M3.3) and the admin web pages (M3.4) are done; websites with Payload (M3.5) are next.

On request, the PostgreSQL and Redis foundation was built before the rest of the plan. M0 records what exists. M1 and M2 are planned in detail; later milestones are outlined and get detailed when M2 is done.

## Decisions taken (2026-10-29)

| Decision | Record |
| --- | --- |
| Keycloak is the identity provider | ADR 0009 |
| No Stripe account yet: payments are built for Stripe and run on a labelled development provider until keys exist | ADR 0010 |
| One company, "Testing Company" (placeholder name), bills all three schools. This is data in the development seed, not code; the model still supports one company per school or per offering | `db/seeds/development.sql` |
| Development domains under `pythagoras.localhost` | ADR 0011 |

## M0 · Database foundation — complete

**Scope:** PostgreSQL and Redis configuration, roles, schemas, core data model, row-level security, GDPR measures, migrations, backups, tests.

**Acceptance criteria and evidence**

| Criterion | Evidence |
| --- | --- |
| Current, pinned versions | PostgreSQL 18.6, Redis 8.10.2, dbmate 2.34.1, pinned by digest (ADR 0001–0003) |
| Least-privilege roles; no superuser for applications | `db/bootstrap/cluster.sql`; test 01 |
| RLS on every table; parents see only authorised children | Tests 01, 02 |
| Staff isolated per school; CEO and group roles across schools | Tests 03, 04 |
| School-specific pricing; preserved historical prices | Test 05 |
| Concurrent attempts for the last seat | `scripts/db-test-concurrency.sh` (two real sessions) |
| Duplicate and out-of-order payment events; failed payments; expiry; late payment | Tests 06, 07 |
| Correct billing-entity allocation; split checkout | Test 08 |
| Cancellation, credits and refunds; lunch refund leaves enrolment and other services intact | Test 09 |
| School-level revenue and outstanding balances | Test 10 |
| Audit redaction, consent, subject requests, pseudonymisation | Test 11 |
| Fourth school added with data only | Test 12 (database level; the administration UI comes in M3) |
| Migrations apply, roll back and re-apply from empty | `scripts/db-test.sh` |
| Backup restores to an identical database | `scripts/db-restore-check.sh`, run by the test suite |
| Redis ACLs, `noeviction`, AOF; BullMQ works under the restricted user | `scripts/redis-test.sh` |

**Last results (2026-10-29):** `scripts/db-test.sh` — 162 checks passed. `scripts/redis-test.sh` — 11 checks passed.

**Known limits of M0**
- No TLS inside the local Compose network; production requirements are in `docs/operations.md`.
- Point-in-time recovery (pgBackRest) is documented, not built; it belongs to the production-deployment milestone.
- Retention periods and processing purposes are empty until the DPO approves them; the retention job does nothing until then.
- The database rules are enforced and tested at the SQL level only. No API or UI uses them yet.

## M1 · Repository, identity and authorization — complete

**Goal:** from a clean clone, one command starts the stack; seeded people sign in through Keycloak, and every API request runs under their own row-level security context.

| Step | Depends on | Delivers | Status |
| --- | --- | --- | --- |
| M1.1 Identity service and development data | M0 | Keycloak in Compose with its own database and role; `pythagoras` realm (no self-registration, brute-force protection, password policy, PKCE web client, API audience); development users linked to seeded people; seed with Testing Company and three schools; identity tests | **Done** (2026-10-29): `scripts/identity-test.sh` 25 checks; clean start on empty volumes verified |
| M1.2 Monorepo and toolchain | M0 | pnpm workspace: `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared`; Node 24 LTS pinned; development containers with dependencies in Docker volumes (not in the OneDrive folder); lint, type check, unit tests | **Done** (2026-10-29): `scripts/check.sh` passes (install from lockfile, type check, lint, format, 33 unit tests, builds of all three packages); built API and web app start; versions and trade-offs in ADR 0012 |
| M1.3 API authentication and request context | M1.1, M1.2 | Token verification (issuer, audience, expiry, signature via JWKS); person resolved through `access.resolve_login`; one transaction per request with `SET LOCAL app.person_id`; `GET /me` (person, roles, authorised children) and `GET /schools` | **Done** (2026-10-29): ADR 0013; API runs in Compose (`http://localhost:53001`); 36 unit tests (every token failure mode, guard 401/403, structural rules) and 10 integration tests with real Keycloak tokens (`scripts/api-integration-test.sh`) |
| M1.4 Web sign-in | M1.3 | Server-side OpenID Connect sign-in and sign-out with PKCE; session cookie, no tokens in the browser; role-aware home page for parent, staff and CEO | **Done** (2026-10-29): ADR 0014; web app in Compose (`http://localhost:53000`); 23 unit tests; 12 end-to-end tests through the real Keycloak login form (`scripts/web-e2e-test.sh`), covering PKCE and state, encrypted HttpOnly cookies, role views, unlinked accounts, open-redirect refusal, token refresh, and sign-out that ends the Keycloak session |
| M1.5 Worker skeleton | M1.2 | Worker from the API image; BullMQ on the `pyth_queue` user; outbox relay; monthly audit-partition job | **Done** (2026-10-29): worker in Compose as `pyth_worker` / `pyth_queue`; outbox relay with row locking, retry backoff and a guard that refuses personal data; event dispatcher; scheduled audit-partition and webhook-payload purge jobs; graceful shutdown; 30 new unit tests and 5 integration tests against PostgreSQL and Redis |
| M1.6 Gateway and CI | M1.3, M1.4 | Gateway routing `*.pythagoras.localhost`; GitHub Actions: type check, lint, unit tests, database and Redis suites, image builds | **Done** (2026-10-29), ADR 0015: Caddy gateway with host routing (12 checks, `scripts/gateway-test.sh`); production HTTPS restricted to verified domains through `/internal/tls/allowed` (9 integration tests); production images for API/worker and web, verified to run as `node` without source; CI workflow with three jobs. Every suite passes locally and in CI on GitHub (first full run green after fixing script permissions for Linux, commit 65cefad) |

**Acceptance criteria**
1. `docker compose up` from a clean clone starts gateway, web, API, worker, Keycloak, PostgreSQL and Redis, all healthy.
2. The seeded parent signs in and sees exactly their two children at two different schools; the principal of School A sees only School A; the CEO sees all three schools.
3. The API rejects tokens with a wrong issuer, wrong audience, bad signature or past expiry, and refuses requests from a Keycloak user with no linked person.
4. No API code path queries PostgreSQL without a person context, except named system endpoints (health, webhooks, hostname resolution).
5. CI runs type check, lint, unit tests, the database and Redis suites, and image builds on every push.

## M2 · First vertical slice — complete

**Goal:** the journey from the requirements, end to end, on the development payment provider (ADR 0010).

| Step | Depends on | Delivers | Status |
| --- | --- | --- | --- |
| M2.1 Catalog read model | M1 | Parent sees, per child, the offerings of that child's school with current prices, dates, cutoffs and free places | **Done** (2026-10-29): `GET /students/:id/offerings` under the parent's row-level security; another family's child answers 404 |
| M2.2 Basket and order placement | M2.1 | Validate permission, eligibility, price, deadline and capacity; one order per billing entity; reserve seats; idempotency keys | **Done**: `POST /checkout` with a required `Idempotency-Key`; pure basket planner (one line per lunch day, one per club); orders, lines, reserved bookings and payment in one transaction; a repeated key returns the same checkout |
| M2.3 Payment provider port | M2.2 | Port with the `development` adapter (signed events, succeed/fail/abandon) and the `stripe` adapter (built, disabled without keys) | **Done**: both adapters; the Stripe adapter is unit-tested against Stripe's documented formats only (no account) |
| M2.4 Webhook and confirmation | M2.3, M1.5 | Signature check, duplicate-safe storage, worker confirmation in one transaction, out-of-order handling, reservation expiry, late-payment recovery | **Done**: `POST /webhooks/:provider` stores verified events only; the worker applies them oldest first, each in its own savepoint; reservation expiry every minute; a late payment confirms if a seat is free, otherwise becomes credit with the same company |
| M2.5 Parent confirmation | M2.4 | Order status page driven by the server state (never by the browser redirect); confirmation message through the outbox | **Done, except the message**: `/services`, `/checkout` and `/orders/[group]` in the web app; the page refreshes itself until the worker has confirmed; `commerce.order.paid` is written to the outbox, but no e-mail is sent yet (no handler subscribes; notifications come with M7) |
| M2.6 School Life views | M2.4 | Kitchen counts per school and day, with dietary flags; activity registers | **Done** (2026-10-29): `GET /school-life/kitchen` and `/school-life/registers`, pages under `/school-life/` linked from staff home pages. Meals count paid bookings only (unpaid reservations shown apart); dietary needs listed most dangerous first, as alerts, only where the viewer holds `sensitive.dietary.read`; the CEO sees counts without health data, the School A kitchen sees School A only and no class names. Registers are read-only: marking attendance is not built yet (M4) |
| M2.7 CEO reporting | M2.4 | Revenue and outstanding balances per school from the `reporting` views | **Done** (2026-10-29): `GET /reports/revenue` (period in school-local dates, default this month, at most a year) and `/reports/revenue` in the web app, linked for roles with `reports.read`. Per school: received, paid by credit, refunded, credited, net; unpaid staff invoices and overdue; checkouts in progress; credit owed to families. Migration `20261031090000` splits `reporting.school_revenue_daily` by `payment_mode`, so test-mode money (the development provider) has its own column and is never shown as revenue. The CEO sees all schools, a principal their own, teachers, the kitchen and parents nothing |
| M2.8 Authorised cancellation | M2.4 | Staff cancel a lunch day; credit issued to the payer; enrolment and other services untouched | **Done** (2026-10-29): `GET /school-life/lunch` (children booked at one school on one day) and `POST /school-life/bookings/:id/cancel` with a required reason, for staff with `bookings.manage` at the school (not the kitchen or teachers), for paid lunch days that have not passed. The API cancels the booking and its line and writes `commerce.order_line.cancelled`; the worker then issues credit for exactly what was paid for that line, with the same billing entity, and the balancing `credit_issued` allocation. A unique index allows one credit per line (migration `20261101090000`). Web: each day on the kitchen page opens its lunch list with a cancel form. Club bookings, other lines and enrolments are untouched |

Tests added for M2.1–M2.5: 22 API unit tests (signatures, both adapters, basket rules, error mapping, expiry schedule), 11 API integration tests against the running stack (purchase and confirmation, idempotency, another family's child, duplicate and out-of-order webhooks, forged signature, failed payment, expiry, late payment with a free seat and with a full session), 8 web unit tests, 3 end-to-end tests through the web app and the real Keycloak login (Anna's purchase, cross-site form refusal, another family's order) and 2 gateway checks. `scripts/db-reset-test-data.sh` clears earlier test orders so the suites can run repeatedly.

Tests added for M2.6: 1 API unit test (dietary order), 7 API integration tests (counts per role after a real purchase, unpaid reservations kept apart, parents refused, parameter checks, registers per school), 6 web unit tests and 5 end-to-end tests (coordinator, School A kitchen, CEO, register, parent). API integration files now run one after another, since they share the development database.

Tests added for M2.7: 1 database check (test money reported as test), 4 API unit tests (report assembly, test money kept apart, schools without money, precision), 5 API integration tests (CEO sees the purchase as test money at the right schools, default period, principal's own school, refused roles, period checks), 5 web unit tests and 3 end-to-end tests (CEO view, principal and teacher, unusable period).

Tests added for M2.8: 1 database check (one credit per line), 4 API unit tests (who may cancel what, and when), 8 API integration tests (refused roles, reason required, exact credit with the same company, nothing else changed, kitchen count, CEO figures, no second cancellation or credit), 2 web unit tests and 2 end-to-end tests (School Life cancels from the lunch list and Anna sees it; cross-site form refused).

**Acceptance criteria status:** 1, 2, 4 and 6 are met and covered by the end-to-end and integration suites. 3: revenue per school is correct, and credited, net and credit owed update after a cancellation; staff invoices ("outstanding") cannot be created in the app yet. 5: the end-to-end journey and the payment edge cases run in the CI workflow and passed on GitHub for every M2 commit (runs #5–#12, and #13–#14 for M3.1).

**Acceptance criteria**
1. Parent Ivanova, with children at School A and School C, buys lunch for both and an activity for one, pays on the development provider, and sees the confirmation only after the worker has confirmed it.
2. School Life sees correct kitchen counts for both schools and the activity register.
3. The CEO sees correct revenue per school; balances update after the cancellation.
4. Cancelling one lunch day produces a credit of exactly that day's price; the activity and enrolments are unchanged.
5. End-to-end test runs the journey in CI; duplicate and out-of-order events, failed payment and expired reservation are covered by automated tests.
6. Every screen showing a development payment says so.

## M3 · School onboarding and websites — in progress

**Goal:** a group administrator adds a fourth school and its website entirely through the platform, with no code change, migration or deploy, and a parent completes the M2 journey there. The database side is already proven by `db/tests/12_fourth_school.sql` (a fourth school creates no schema objects).

| Step | Depends on | Delivers | Status |
| --- | --- | --- | --- |
| M3.1 Onboarding API | M2 | For group administrators (`org.manage`, `catalog.manage`, `access.manage`): add a billing company; create a school as a draft (code, name, kind, time zone, billing company); add offerings from the group's service definitions with a first price and booking policy; generate sessions (lunch on school days between two dates, skipping closures; clubs weekly); register staff and give them a role at the school; activate the school. Every write under the administrator's row-level security | **Done** (2026-10-30): `GET /admin/onboarding`, `POST /admin/billing-entities`, `/admin/schools`, `/admin/schools/:id/offerings`, `/sessions`, `/staff`, `/activate`. Gate: `org.manage`; the database then checks `catalog.manage`, `people.manage` and `access.manage` per write (the CEO can create a school but not price it). Lunch calendars close booking at 10:00 and cancelling at 14:00 the day before, school time; clubs close 24 hours before. Session generation is idempotent. Activation needs a priced offering, sessions for every published offering and a principal. Staff get a person record and role, but no sign-in yet (M3.2) |
| M3.2 Accounts for new people | M3.1, M1.1 | Keycloak users for staff and parents created through the Keycloak admin API by a dedicated service account (no self-registration), linked to their person record, with an e-mailed "set your password" action; until e-mail exists, a one-time temporary password in development only | **Done** (2026-10-30), ADR 0016: `POST /admin/people/:id/account` for group administrators; service account `pythagoras-provisioning` limited to user management; the Keycloak user is removed again if linking fails; an address that already signs in is refused. Development returns a 24-character temporary password once (`no-store`) that must be changed at first sign-in; production must use `ACCOUNT_SETUP=email`, which needs SMTP (M7) |
| M3.3 Students and families | M3.1 | Principal enrols students and records guardians (verified on creation by the principal); a parent with children at several schools sees all of them | **Done** (2026-10-30): `GET/POST /schools/:id/students` and `POST /schools/:id/students/:studentId/guardians` for the school's staff (enrolment.manage, people.manage, guardians.manage; the school must be active, or the caller a group administrator). A guardian recorded by staff is active and verified by them. An existing parent is found by exact e-mail through `people.find_person_by_email` (migration `20261102090000`): id only, only for staff who manage guardians at that school, every lookup in the access log, so a parent is never registered twice. Proven end to end: School T, billed by its own company, enrols Anna's third child; Anna sees three children at three schools and one basket gives one order per company, both paid |
| M3.4 Admin web | M3.1–M3.3 | Onboarding pages in the web app for group administrators: company, school, offerings and prices, session calendar, staff, activation, with a checklist of what is missing before a school can go live | **Done** (2026-10-30): `/admin/schools` (schools with status and what is missing, add a company, add a school) and `/admin/schools/[id]` (offerings and prices typed in euros, school-day and weekly calendars with closed days, staff with "Create sign-in account", activation enabled only when nothing is missing), linked from the home page for group administrators. All forms post to `/admin/actions` (same-origin only), which calls the API and returns with a notice. The temporary password is shown only on the direct answer to the form (`no-store`, no redirect), so it is in no address, history entry or log. New API read: `GET /admin/schools/:id`. Students and families pages for principals are not built yet (the API exists, M3.3) |
| M3.5 Websites (Payload) (next) | M3.1 | Payload CMS as its own service with its own database role and schema, one tenant per `org.website.cms_tenant_key`; the web app renders a school's public pages for the host name resolved by `org.resolve_hostname`; a new website at `<code>.pythagoras.localhost` in development. ADR before building | Planned |
| M3.6 Domains | M3.5, M1.6 | Real domains verified by the worker (DNS TXT or HTTP token), then served by the gateway's on-demand TLS; `.test` and `.localhost` stay local-development only | Planned |
| M3.7 Fourth school end to end | M3.1–M3.6 | One test in CI: create School D from nothing, publish its website, enrol a child, the parent pays for lunch, School D's kitchen and the CEO see it. No code or schema change between "three schools" and "four" | Planned |

Tests added for M3.1: 6 API unit tests (school and weekly calendars, closures, date checks, activation readiness) and 13 API integration tests (who may add schools, draft school, duplicate code, unknown time zone, draft hidden from parents, offerings and the CEO refused pricing, activation refused until ready, lunch and club calendars in the school time zone and never twice, principal, activation, no new tables). `scripts/db-reset-test-data.sh` (renamed from `db-reset-commerce.sh`) now also removes schools with codes starting `test-`; the identity, API and end-to-end scripts run it first, and tests no longer assume exactly three schools.

Tests added for M3.2: 8 API unit tests (Keycloak calls against a fake Keycloak: user payload, temporary password, e-mail mode, existing address, clean-up, token reuse; production refuses temporary passwords) and 7 API integration tests against the real Keycloak (refused roles, unknown person, account created and linked, no second account, existing address refused, new password required at first sign-in, then the person signs in as their own record with their role). The test-data reset also removes Keycloak users named `test-…`.

Tests added for M3.3: 8 database checks (the e-mail lookup: exact and case-insensitive, id only, refused for other schools, teachers and anonymous callers, logged) and 9 API integration tests (enrol, link an existing parent, refuse a duplicate link, register a new guardian with names, list with permissions, other schools' staff refused, Anna's three children, the two-company basket paid). Fixed on the way: creating a billing company without a registration number gave a server error; the API now requires it (400) and reports a duplicate number as 409. The M1 test of Anna's children no longer assumes she has exactly two.

Tests added for M3.4: 1 API integration test (the set-up read and its refusal for principals), 10 web unit tests (amounts in euros, closed-day lists, form to request for school, offering, calendars and staff, safe return addresses, the set-up link) and 2 end-to-end tests (the administrator goes from a new company to a live school through the pages, including the one-time password; principals and cross-site forms are refused).

**Acceptance criteria**
1. School D, its company, prices, calendar, staff and website are created through the platform by a group administrator; the change contains no code, migration or configuration file.
2. Staff at School D see only School D; other principals see nothing of it.
3. A parent with children at School A and School D buys lunch at both; each order is billed by the right company.
4. School D's website is served on its local domain; an unverified real domain is never served.
5. The end-to-end test runs in CI.

## Later milestones (outline)

| Milestone | Depends on | Outcome |
| --- | --- | --- |
| M4 · School Life services | M2 | Lunch menus and dietary handling, activities, lessons and packages, trips and consent, transport seats, uniforms and stock, parent requests |
| M5 · Admissions and CRM | M1 | Inquiries, applications, enrolment hand-off |
| M6 · Staff, documents, tasks | M1 | Staff records and qualifications, documents and approvals, tasks and projects |
| M7 · Integrations | Contracts in `docs/integration-register.md` | Shkolo, accounting export, e-signature, notifications: only after each contract is confirmed |
| M8 · Production deployment | M2 | Production Compose, TLS, PgBouncer, pgBackRest, monitoring, restore drills |

## Open items

- Staff multi-factor sign-in: Keycloak authentication flow to be configured before production (ADR 0006, 0009).
- Stripe test-mode account: when available, follow the switch-over steps in `docs/operations.md` (Payments). Not built yet in the Stripe adapter: fetching the authoritative payment state, refunds, and expiring the Stripe session when our reservation expires.
- Parent confirmation e-mail for `commerce.order.paid` (needs the notification integration, M7).
- Web pages for principals to enrol students and record guardians (the API exists since M3.3).
- Booking before a child's first day: the catalogue offers lunch only for enrolments that have already started, so parents of a child starting next month cannot book the first days yet. Decide whether to allow sessions on or after the start date.
- Real names for the company and schools replace the placeholders in the seed when known.
