# 0009 Keycloak as the identity provider

Date: 2026-10-29 · Status: Accepted (decided by the network)

## Decision

- Keycloak 26.8.1 (`quay.io/keycloak/keycloak:26.8.1`, digest `sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b`), self-hosted in Docker.
- Its data lives in its own PostgreSQL database `keycloak`, owned by its own role `pyth_keycloak`, in the same cluster as the platform. Keycloak never touches the `pythagoras` database, and platform roles cannot connect to `keycloak`.
- One realm, `pythagoras`, for parents and staff. Keycloak **authenticates**; the platform **authorizes**. Roles and school scopes stay in `access.role_assignment`, not in Keycloak, so permissions are defined in one place and enforced by row-level security.
- A Keycloak user's id (`sub`) is linked to a person through `people.login_identity` (provider `keycloak`).
- Realm security: no self-registration (accounts come from staff invitations), brute-force protection, a 12-character minimum password without composition rules, 5-minute access tokens, refresh-token rotation, login events kept 30 days.
- Clients: `pythagoras-web` (confidential, authorization code with PKCE), `pythagoras-api` (audience only). The development realm adds `pythagoras-dev-tests` (password grant for automated tests) and synthetic users; neither may exist in production.

## Consequences

- Multi-factor sign-in for staff (ADR 0006) is a realm authentication-flow setting. It is required before production and tracked in the plan; development users have no second factor so tests can run.
- The production realm file is a separate, user-free export (milestone M8).
- If the network later adopts Microsoft Entra ID or Google Workspace, Keycloak can broker them as identity providers without changing the platform.
