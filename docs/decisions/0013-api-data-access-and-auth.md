# 0013 API data access and authentication

Date: 2026-10-29 · Status: Accepted

## Data access

- **node-postgres (`pg` 8.23) with SQL written in each module's repository**, no ORM. The schema is defined by SQL migrations with RLS, column grants and triggers (ADR 0003); queries written in SQL say exactly what runs under those rules and are easy to review against the policies.
- **One way in.** The `Database` service exposes `withPerson(context, work)`, which opens a transaction, sets `app.person_id`, `app.request_id` and `app.actor` with `SET LOCAL`, runs the work and commits. The only other entry points are named system operations (`resolveLogin`, readiness ping), each a single fixed statement. No other code imports `pg`; a unit test enforces this.
- The API connects as `pyth_api` (ADR 0004), so even a query written outside `withPerson` would see nothing personal: RLS has no person to grant access to.
- Repositories belong to their module and touch only that module's tables, plus read-only joins to reference data through views or permitted selects.

## Authentication

- Access tokens from Keycloak are verified with `jose` 6.2 against the realm's JWKS: signature (RS256 only), issuer, audience `pythagoras-api`, expiry and issue time (5 s clock tolerance), token type `Bearer` (ID tokens are refused), and the issuing client (`azp`) on an allow-list.
- The token subject is resolved to a person with `access.resolve_login`; a valid token with no linked, active person is refused with 403.
- Every route requires a verified person unless it is explicitly marked public (health checks; later webhooks and hostname resolution).
- The issuer is the public Keycloak URL; keys are fetched from the internal URL (`http://keycloak:8080`) so containers do not depend on host networking.
