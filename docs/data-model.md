# Data model

Status: implemented for milestone M0 (database foundation), 2026-10-29. Source of truth: `db/migrations/`. Every rule below is covered by a test in `db/tests/`.

## Conventions

| Topic | Rule |
| --- | --- |
| Keys | `uuid` primary keys from `uuidv7()`; human numbers (order numbers) are separate columns |
| Money | `bigint` minor units (cents) + `currency char(3)`, default `EUR`; VAT as basis points |
| Time | `timestamptz` in UTC for instants; `date` for service days, read in the school's IANA time zone |
| Status | Each record type has its own status column; allowed transitions live in `meta.state_transition` and are enforced by trigger |
| History | Prices and policies are immutable versions; order lines copy the agreed price; financial allocations are append-only |
| Audit | Every business table has an audit trigger; personal columns are redacted in `audit.change_log` |
| Integrity across schools | Composite foreign keys carry `group_id`, `school_id` or `billing_entity_id`, so a row can never point at another school's or company's records |
| Naming | One schema per business capability; tables are singular nouns |

## Concepts kept separate

| Concept | Table | Notes |
| --- | --- | --- |
| Education group | `org.education_group` | The "mother system". Default time zone, currency, locale |
| School or campus | `org.school` | Kind: school, kindergarten, sports academy, training centre, college, other. Own time zone and status (draft, active, archived) |
| Legal billing entity | `org.legal_entity` | Issues invoices, receives payments. One entity can run several schools |
| Website | `org.website` | Presents one or more schools (`org.website_school`); a school may have several websites |
| Verified domain | `org.website_domain` | Only verified domains of live websites are routed (`org.resolve_hostname`). Real domains are verified by the worker; `.test` / `.localhost` may be marked verified for development |
| Person | `people.person` | One record per person per group, whatever schools they touch |
| Login identity | `people.login_identity` | Identity-provider subject linked to a person. Children may have none |
| Guardian relationship | `people.guardian_relationship` | Individually authorised, staff-verified, time-bounded, with capabilities `can_view`, `can_pay`, `can_manage_bookings`, `can_consent` |
| Student enrolment | `people.enrolment` | Student × school × period. No overlapping current enrolments at one school |
| Role and permission | `access.role`, `access.permission`, `access.role_permission`, `access.role_assignment` | Group-scoped or school-scoped assignments; policies check permissions |
| Shared service definition | `catalog.service_definition` | Group-level: lunch, activity, lesson, trip, transport, uniform, tuition, fee |
| School-specific offering | `catalog.school_offering` | A school's offering of a service, billed by one legal entity |
| Session or service date | `scheduling.session` | A lunch day, an activity meeting, a lesson slot, a trip. Capacity and counters |
| Price version | `catalog.price_version` | Immutable; non-overlapping validity periods |
| Policy version | `catalog.policy_version` | Immutable booking, cancellation and sale terms |
| Booking | `scheduling.booking` | A student on a session: reserved, confirmed, cancelled, expired, attended, absent |
| Order | `commerce.customer_order` | One billing entity per order; baskets across entities share `checkout_group_id` |
| Order line | `commerce.order_line` | Copies price, VAT and terms; frozen once the order is placed |
| Payment | `commerce.payment` | One provider attempt; success only from the worker after a verified provider event |
| Allocation | `commerce.payment_allocation` | Append-only ledger per line, school and entity: payments, refunds, credit issued, credit applied |
| Credit | `commerce.account_credit`, `commerce.credit_application` | Owed by one entity to one payer; usable only with the same entity |
| Refund | `commerce.refund` | Requested, approved by a second person, processed; never above the payment |

Not yet modelled (later milestones): admissions and CRM, academics and timetables, lunch menus, trips and consent forms, transport routes and seats, uniform variants and stock, lesson packages, HR records and qualifications, documents and approvals, tasks and projects.

## Schemas

| Schema | Owns |
| --- | --- |
| `org` | Group, legal entities, schools, websites, domains |
| `people` | Persons, login identities, guardian relationships, enrolments |
| `access` | Roles, permissions, assignments, authorization helper functions |
| `catalog` | Service definitions, school offerings, price and policy versions |
| `scheduling` | Sessions, capacity counters, bookings |
| `commerce` | Orders, lines, payments, allocations, credits, refunds |
| `integration` | Transactional outbox, verified inbound provider events, external references |
| `privacy` | Processing purposes, retention policies, consent records, data subject requests |
| `sensitive` | Dietary and health requirements (special-category data) |
| `audit` | Change log (monthly partitions), access log |
| `reporting` | Read models: `school_revenue_daily`, `outstanding_balance` |
| `app`, `meta`, `extensions` | Request context helpers, state machines and migration history, extensions |

## Who can read what

Row-level security applies to every table (ADR 0005). Summary of the main rules:

| Data | Parent (guardian) | School staff | Group roles | Anonymous |
| --- | --- | --- | --- | --- |
| Person | Self and children with `can_view` | People connected to their school, with `people.read` | With `people.read`: everyone in the group | None |
| Enrolment, booking | Their children's | Their school's, with the matching permission | All schools, with the matching permission | None |
| Dietary and health | Their children's | Their school's students, with `sensitive.dietary.read` (principal, kitchen) | School Life coordinator only; not the CEO or finance | None |
| Order, payment, credit | Their own as payer | Orders with a line at their school, with `finance.read` | With `finance.read` | None |
| Published offerings, sessions, prices; active schools; live websites | Yes | Yes | Yes | Yes |
| Audit log | No | No | With `audit.read` (CEO, privacy officer) | No |

Writes the API can never make, whoever is signed in: confirm a payment, mark an order paid, confirm a reservation, rewrite a price, edit a placed order's lines, alter the audit log or financial ledger, verify a real domain, grant a role outside its own scope or to oneself, approve a refund it requested.

The worker (`pyth_worker`) acts as the system on the tables its jobs need. It cannot read health data or the audit log, and cannot change prices, lines or the ledger.

## Error codes

| SQLSTATE | Meaning |
| --- | --- |
| `PY001` | Status transition not allowed |
| `PY002` | Session is full |
| `PY004` | Record is immutable or append-only |
| `PY005` | Unknown time zone |
| `PY006` | Role scope mismatch (group role with a school, or the reverse) |
| `PY007` | Session not open for booking |
| `PY008` | Order or line does not match the price version, currency or total |
| `PY009` | Credit inactive or insufficient |
| `PY010` | Payment not succeeded, or refunds would exceed it |
| `PY011` | Person not found or already pseudonymised |

Standard codes the API should also map: `42501` (not permitted), `23505` (duplicate, e.g. idempotency key), `23503` (wrong school or company reference), `23P01` (overlapping version), `23514` (check failed).

## Payment flow in the database

1. **Validate and reserve.** The API, as the parent, inserts a draft order for one billing entity, its lines at the current price, and `reserved` bookings in one transaction. Capacity is enforced by the session row lock and a check constraint, so two parents cannot take the last seat.
2. **Place.** The order moves to `pending_payment` only if its total equals its lines. Lines are then frozen.
3. **Checkout.** The API records a `created` payment and the provider checkout id.
4. **Verify.** The webhook endpoint stores the provider event only if its signature was verified; the unique key makes duplicates harmless.
5. **Confirm.** The worker, in one transaction, marks the payment `succeeded`, the order `paid`, the lines and bookings `confirmed`, writes allocations per line and an outbox event. Out-of-order events cannot move states backwards.
6. **Exceptions.** Unpaid reservations expire and release seats. A late payment can complete an expired order if a seat is still free; otherwise the booking cannot be confirmed and the money becomes a refund or credit. Cancelling a lunch changes only that line and booking, never the enrolment or other services.
