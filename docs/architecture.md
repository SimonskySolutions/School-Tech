# Architecture

Status: the data layer (PostgreSQL and Redis) is built and tested (milestone M0). The application services below are the agreed target and are not built yet. The requirements brief is authoritative; the three-view PDF ("Pythagoras Three Architecture Views", 29 October 2026) is the starting design.

## Target shape

One modular monolith, organised by business capability, deployed as a small set of containers:

| Service | Role | Status |
| --- | --- | --- |
| gateway | HTTPS, verified domains, routing per website | Planned |
| web | Next.js: school websites, family portal, staff and CEO workspaces | Planned |
| api | NestJS modular backend; verifies Keycloak tokens; runs each request in a person-context transaction for PostgreSQL RLS (ADR 0013) | **Built**: sign-in, `/me`, `/schools`, health; business modules follow |
| worker | Same image as the API; BullMQ jobs: payment confirmation, expiry, notifications, synchronisation, retention | Planned |
| cms | Payload CMS for school content, one tenant per website | Planned |
| identity | Keycloak 26.8.1, own database and role, realm `pythagoras` (ADR 0009) | **Built** (development realm) |
| postgres | System of record, RLS, outbox | **Built** |
| redis | BullMQ queues only | **Built** |
| object storage | Private documents and files (S3-compatible) | Planned |
| migrate | One-off migration job (dbmate) | **Built** |

## Data layer (built)

- PostgreSQL 18.6 and Redis 8.10.2, pinned by digest (ADR 0001, 0002).
- Plain SQL migrations with dbmate (ADR 0003); least-privilege roles (ADR 0004); person-context row-level security on every table (ADR 0005); GDPR measures in the data layer (ADR 0006); money, time and identifiers (ADR 0007); one order per billing entity (ADR 0008).
- Details: `docs/data-model.md`. Operations, backups and upgrades: `docs/operations.md`.

## Changes to the proposed design

The PDF design holds up. These changes follow from the requirements brief:

| PDF view | As proposed | Change | Why |
| --- | --- | --- | --- |
| 3 · Payments | One hosted checkout per purchase | **One checkout per billing entity**; a basket across companies becomes several orders and payments, explained to the parent | A hosted checkout collects for one merchant; combined collection for independent companies is not validated (ADR 0008) |
| 3 · Payments | Provider event verified, then one transaction | The API endpoint only verifies the signature and stores the event; **the worker confirms** order, payment, entitlements, allocations and outbox in one transaction | Keeps confirmation out of user-facing requests, makes retries and out-of-order handling uniform |
| 3 · Payments | Order and payment states implied | **Separate state machines** for orders, lines, payments, bookings, refunds and credits, enforced in the database | Required by the brief; prevents out-of-order events moving states backwards |
| 2 · Deployment | Redis for "job queues and suitable caching" | **Redis for queues only** (`noeviction`, AOF); a cache, if needed, is a second instance | BullMQ requires `noeviction`, a cache needs eviction (ADR 0002) |
| 2 · Deployment | Identity "optional" | **Identity is required**: Keycloak by default, or the provider the network already uses | The brief requires an established identity provider; every module depends on it |
| 2 · Deployment | CMS beside the API | Payload gets **its own database and role**, reads school configuration from the API, and never reads business tables | Payload manages its own schema; business data stays behind RLS |
| 1 · Platform | "School websites A, B, C" | **Websites and domains are separate from schools** (many-to-many); domains are verified before routing | One school may have several sites; one site may present several schools |
| 1 · Platform | "School configuration and scoped permissions" | Scoped permissions are **enforced twice**: API authorization and PostgreSQL RLS; shared records (people, families, orders) have their own rules | The brief requires both controls and forbids a blanket `school_id` filter |
| 1 · Platform | Reporting inside Tasks and reporting | Reports are **RLS-respecting views** (`reporting` schema); a read replica later | The CEO sees all schools, a principal only theirs, from the same views |

Open decisions that affect the next milestone are listed in `docs/implementation-plan.md`.
