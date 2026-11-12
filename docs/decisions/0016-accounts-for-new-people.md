# 0016 Sign-in accounts for people an administrator registers

Date: 2026-10-30 · Status: Accepted

## Context

From M3, group administrators register new staff (and later parents) through the platform. Those people need a Keycloak account linked to their person record before they can sign in. Self-registration stays off (ADR 0009): an account must only ever belong to someone the school has registered. E-mail is not set up yet (M7), so Keycloak cannot send "set your password" messages.

## Decision

- **A dedicated service account.** The API calls Keycloak's admin API as `pythagoras-provisioning` (client credentials). Its only roles are `manage-users`, `view-users` and `query-users` in the `pythagoras` realm: it can create, find, update and remove users, and is refused roles, clients and every other realm (checked). Its secret is a Docker secret (`keycloak_provisioning_client_secret`), never in the image or the realm file.
- **The person record is the source of truth.** `POST /admin/people/:id/account` creates the Keycloak user from the person's name and e-mail (user name = lower-cased e-mail) and stores the link in `people.login_identity`. Linking needs `access.manage` for the whole group, so only group administrators can do it, and the database enforces that.
- **Order and clean-up.** The person is checked first (exists, has an e-mail, has no account). The Keycloak user is created outside any database transaction, then the link is written. If the link cannot be written, or a later Keycloak step fails, the Keycloak user is removed again, so no login exists that no person record knows about. An address that already has an account is refused (409) and nothing is linked.
- **First password, two modes (`ACCOUNT_SETUP`).**
  - `temporary_password`, development only: a random 24-character password is returned once (`cache-control: no-store`), never logged, and Keycloak forces a new password at first sign-in. The address is marked verified, because the realm requires a verified address and there is no e-mail to verify it with; the administrator who hands over the password vouches for it. The API refuses this mode when `NODE_ENV=production`.
  - `email`, for production: Keycloak e-mails a link to set the password and verify the address (`UPDATE_PASSWORD`, `VERIFY_EMAIL`, valid three days). Needs SMTP in the realm (M7).

## Consequences

- Until e-mail exists, real people cannot be onboarded in production; development and tests work end to end.
- The realm file gains a client and a service-account user. An existing development realm does not pick up realm-file changes by itself; `scripts/keycloak-reload-realm.sh` re-imports it (synthetic users keep their ids).
- Disabling or removing accounts, and parents' accounts (M3.3), build on the same service account.
