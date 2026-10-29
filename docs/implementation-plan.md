# Implementation plan

Last updated: 2026-10-29. Current milestone: **M0 complete; M1 not started.**

On request, the PostgreSQL and Redis foundation was built before the rest of the plan. M0 below records what exists. M1 onward is a first outline, to be detailed (acceptance criteria per milestone, dependencies, risks) in the planning step that comes next.

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

## Outline of the next milestones (draft)

| Milestone | Depends on | Outcome |
| --- | --- | --- |
| M1 · Repository, identity and authorization | M0 | Monorepo (Next.js, NestJS, shared types), Docker services, Keycloak, login linked to `people.login_identity`, per-request RLS context, CI (types, lint, tests, image builds) |
| M2 · First vertical slice | M1 | A parent with children at two schools buys lunch and an activity through Stripe test checkout; School Life sees kitchen counts and registers; the CEO sees revenue and balances; an authorised cancellation creates the correct credit |
| M3 · School onboarding and websites | M1, M2 | Admin onboarding for a fourth school and its website (Payload, local test domain), completing the M2 journey without code changes |
| M4 · School Life services | M2 | Lunch menus and dietary handling, activities, lessons and packages, trips and consent, transport seats, uniforms and stock, parent requests |
| M5 · Admissions and CRM | M1 | Inquiries, applications, enrolment hand-off |
| M6 · Staff, documents, tasks | M1 | Staff records and qualifications, documents and approvals, tasks and projects |
| M7 · Integrations | Contracts in `docs/integration-register.md` | Shkolo, accounting export, e-signature, notifications: only after each contract is confirmed |
| M8 · Production deployment | M2 | Production Compose, TLS, PgBouncer, pgBackRest, monitoring, restore drills |

## Decisions needed before M1

1. Identity provider: does the network already use Microsoft 365 or Google Workspace (then that provider), or is Keycloak preferred?
2. A Stripe account in test mode for development (keys stay in `secrets/`, never in the repository).
3. The real legal entities and which schools each one bills, to replace the synthetic fixtures with a development seed.
