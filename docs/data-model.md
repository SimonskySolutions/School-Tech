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
| `reporting` | Read models: `school_revenue_daily` (per school, local day and `payment_mode`: test-mode money is never live revenue), `outstanding_balance` |
| `app`, `meta`, `extensions` | Request context helpers, state machines and migration history, extensions |

## Who can read what

Row-level security applies to every table (ADR 0005). Summary of the main rules:

| Data | Parent (guardian) | School staff | Group roles | Anonymous |
| --- | --- | --- | --- | --- |
| Person | Self and children with `can_view` | People connected to their school, with `people.read` | With `people.read`: everyone in the group | None |
| Enrolment, booking | Their children's | Their school's, with the matching permission | All schools, with the matching permission | None |
| Dietary and health | Their children's; record and change them with `can_manage_bookings`, never verify | Their school's students, with `sensitive.dietary.read` (principal, kitchen); verify with `sensitive.dietary.manage` | School Life coordinator only; not the CEO or finance | None |
| Lunch menus | Of the lunch days they can book | Read where they see the lunch day; publish with `menus.manage` (principal, kitchen) | School Life coordinator publishes everywhere | Published lunch days only |
| Order, payment, credit | Their own as payer | Orders with a line at their school, with `finance.read` | With `finance.read` | None |
| Published offerings, sessions, prices; active schools; live websites | Yes | Yes | Yes | Yes |
| Audit log | No | No | With `audit.read` (CEO, privacy officer) | No |

The School Life views (kitchen counts, club registers) are built on these rules rather than on rules of their own: a viewer gets sessions and counts only where they hold `bookings.read`, children's names only with `people.read`, classes only with `enrolment.read`, and dietary needs only with `sensitive.dietary.read`. Counts come from the session counters that the booking triggers maintain; "meals" are confirmed (paid) bookings.

Trips (ADR 0023): the consent wording is a `catalog.policy_version` of kind `trip_consent` (immutable, versioned); `scheduling.trip_permission` records a guardian's permission for one child and trip, pointing at the exact wording, with an emergency contact for the day. It is readable by the child's guardians and by staff with `bookings.read` or `consent.manage` at the school; the emergency contact is redacted in the audit log. A trip booking needs a given permission for the wording in force.

Lessons (ADR 0022): teachers and rooms are `scheduling.resource` rows with weekly hours (`resource_availability`); a lesson slot is a session with capacity 1 whose resources are in `scheduling.session_resource`, where an exclusion constraint keeps a resource out of two overlapping live slots. A paid `per_package` line becomes a `scheduling.lesson_package`; its balance is the sum of the append-only `scheduling.package_entry` ledger (purchase, one entry per booking, one per lesson returned). Families see teacher and room display names, never staff person records; packages are visible to the child's guardians and to the school's staff with `bookings.read` or `finance.read`.

Who may take an offering is `catalog.school_offering.eligibility` (`{"grades", "min_age", "max_age"}`, each optional; ADR 0021), checked on every new booking for that session's day. Attendance is marked only through `scheduling.mark_attendance`, with `attendance.mark` at the booking's school, once the session has started; the booking records who marked it and when.

Dietary needs and menus share one list of allergen codes, the 14 of EU Regulation 1169/2011, Annex II (`catalog.allergen_codes()`, ADR 0020). Whether a need is verified is decided by a trigger, never by the caller: staff with `sensitive.dietary.manage` verify as themselves, and any change by a guardian makes the need unverified again. Every read of dietary rows through the API writes one `audit.access_log` row per child (resources `sensitive.dietary_requirement:kitchen`, `:review` and `:family`).

`people.find_person_by_email(email, school)` is the one way to learn about a person outside one's own scope: it returns only the id of the active person with exactly that address, only to staff who manage guardians at that school, and logs every lookup in `audit.access_log`. It exists so a principal links an existing parent to a new child instead of registering the parent twice.

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
| `PY012` | The child is not eligible for the offering on that day (grades or ages) |
| `PY013` | The session has not started, so attendance cannot be marked yet |
| `PY014` | The lesson package has no lessons left |
| `PY015` | The slot is outside the teacher's or room's weekly hours, or the resource is no longer in use |
| `PY016` | A trip needs a guardian's permission for its current wording first |
| `PY017` | A trip permission cannot be withdrawn while a payment for the trip is open |

Standard codes the API should also map: `42501` (not permitted), `23505` (duplicate, e.g. idempotency key), `23503` (wrong school or company reference), `23P01` (overlapping version), `23514` (check failed).

## Payment flow in the database

1. **Validate and reserve.** The API, as the parent, inserts a draft order for one billing entity, its lines at the current price, and `reserved` bookings (`reserved_until` = now + 30 minutes) in one transaction. Capacity is enforced by the session row lock and a check constraint, so two parents cannot take the last seat.
2. **Place.** The order moves to `pending_payment` only if its total equals its lines. Lines are then frozen. The order's `idempotency_key` is the request key plus the billing entity, so a repeated request finds the same orders.
3. **Checkout.** The API records a `created` payment, then (after the transaction, so no lock is held during the provider call) the provider checkout id and `checkout_url`, and moves the payment to `pending`. `provider` is `development` or `stripe`; a development payment is always `provider_mode = 'test'` (constraint `payment_development_is_test`).
4. **Verify.** The webhook endpoint stores the provider event only if its signature was verified; the unique key `(provider, provider_mode, provider_event_id)` makes duplicates harmless.
5. **Confirm.** The worker reads stored events oldest first (`FOR UPDATE SKIP LOCKED`), locks the order and then the payment, and in one savepoint per event marks the payment `succeeded`, the order `paid`, the lines and bookings `confirmed`, writes one `payment` allocation per line and the outbox event `commerce.order.paid`. An event older than `payment.provider_status_at` is marked `ignored`. An amount or currency that differs from the payment is never applied: the event is retried and then marked `failed` for a person to check.
6. **Exceptions.**
   - *Failed payment*: the payment becomes `failed`, the order `cancelled`, its lines and reserved bookings `cancelled`; the seats are free again.
   - *Expiry*: every minute the worker expires `pending_payment` orders past `expires_at` (unless a payment is `processing`): order and open payment `expired`, reserved bookings `expired`; lines stay `pending`.
   - *Late payment*: a success for an expired order confirms each line whose bookings can still be confirmed (`expired → confirmed`). If a session filled up meanwhile, that line is `cancelled`, an `account_credit` for its amount is issued to the payer with the same billing entity, and a `credit_issued` allocation balances the `payment` allocation.
   - *Authorised cancellation* (M2.8): staff with `bookings.manage` cancel one paid lunch day; the API sets the booking and its line to `cancelled` and writes `commerce.order_line.cancelled`. The worker issues an `account_credit` for what was paid for that line (net of its allocations), with the same billing entity, and a balancing `credit_issued` allocation. `account_credit_one_per_line` (unique `source_order_line_id`) allows one credit per line. The order stays `paid`; the enrolment, the child's other bookings and other lines do not change.
