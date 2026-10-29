# 0005 Person-context row-level security

Date: 2026-10-29 · Status: Accepted

## Context

Schools must be isolated, the CEO must see across schools, School Life works across schools on a limited set of data, and parents see only children they are individually authorised for. A family can span several schools, and a person is not owned by any one school. Putting a `school_id` on every table and filtering by it would be wrong for shared records (people, families, orders paid to a company that runs two schools) and easy to forget in a query.

## Decision

1. **Authorization is decided twice.** The API checks permissions before acting; PostgreSQL row-level security (RLS) enforces the same rules on every query, so a missing `WHERE` clause cannot leak another school's data. Neither replaces the other.
2. **The API sets a person context per transaction**: `SET LOCAL app.person_id`, `app.request_id` and `app.actor`, taken from the verified identity-provider token. `SET LOCAL` ends with the transaction, which keeps it safe with connection pooling.
3. **Access comes from explicit grants, never from look-alike data.** Policies call security-definer helper functions in schema `access`:
   - `access.has_permission(permission, school_id)`: an active role assignment that carries the permission, at group scope (all schools in the group) or at that school.
   - `access.is_guardian_of(student_id, capability)`: an *active, verified* guardian relationship with that capability (`can_view`, `can_pay`, `can_manage_bookings`, `can_consent`). Pending, revoked or expired relationships grant nothing. Surnames, e-mail domains and billing accounts never grant access.
4. **Shared records carry their own rules**, not a borrowed school id:

| Record | Who can read it |
| --- | --- |
| Person | The person; their verified guardians; staff with `people.read` at a school where the person is enrolled or employed; group roles with `people.read` |
| School, website, published offerings, current prices | Everyone in the group, including anonymous website visitors (public information) |
| Enrolment, booking | Guardians with `can_view`; staff with the matching permission at that school; group roles with it |
| Order, payment, credit | The payer; staff with `finance.read` at a school on the order; group finance roles |
| Dietary and health data | Guardians with `can_view`; staff with `sensitive.dietary.read` at the student's school |

5. **Permissions, not role names, appear in policies.** Roles (`group_ceo`, `principal`, `school_life_coordinator`, …) are bundles of permissions in `access.role_permission`, so a new role is data, not a migration.
6. **The worker is a separate database role** with explicit policies per table (ADR 0004). Webhook processing runs in the worker, not in a user's request, so the browser success page never confirms an order.

## Consequences

- The application can never set its own context to escalate: the context only *narrows* what `pyth_api` sees. RLS protects against application query bugs; it does not protect against an attacker who can run arbitrary SQL as `pyth_api`. Parameterised queries remain mandatory.
- Policy helper functions run once per row. Indexes on `access.role_assignment` and `people.guardian_relationship` keep them cheap; heavy reports go through `reporting` views.
- Automated tests check every table has RLS enabled and exercise each rule above.
