# 0034 Production identity: a generated realm and a second factor for staff

Date: 2026-11-02 · Status: Accepted

## Context

M8 needs production sign-in with no development users or clients, a second factor for staff, e-mail for password reset and new accounts, sign-in events kept 30 days and no public administration console (ADR 0006, 0009, 0033). The development realm holds synthetic users and a password-grant test client and must never reach production. Keycloak does not know who is staff: the platform does, from role assignments, which administrators grant and revoke at any time and which may exist before a person has a sign-in.

## Decision

**A production realm generated from the development realm.** `infra/keycloak/production-realm.mjs` writes `infra/keycloak/realm-production/pythagoras-realm.json` from the development realm, so both keep the same clients, roles, token lifetimes, password policy and brute-force protection. Production drops the `pythagoras-dev-tests` client and every user except the provisioning service account; the portal and CMS redirect only to their own callbacks over HTTPS. The code checks fail if the file is out of date. The Keycloak image carries the file and imports it on the first start (`--import-realm`); placeholders (addresses, client secrets, SMTP) are filled from the environment and the secret files then. A realm that already exists is never overwritten, so later realm changes are made through the administration tool.

**Step-up sign-in, decided by the platform.** The realm's browser flow has two levels: a password (level 1, `password`) and a one-time code from an authenticator app (level 2, `mfa`), set up at the first sign-in that asks for it. The API, when `STAFF_SECOND_FACTOR=required` (production refuses anything else), refuses a token without `acr=mfa` from a person who holds any role, answering 403 `second_factor_required`. The web app then signs the person in again asking for `mfa`; Keycloak keeps the password step, so only the code is asked for. Parents and other people without a role are never asked. Because the API asks the database on each request (`access.requires_second_factor`), a role granted or revoked takes effect at once and nothing is copied into Keycloak.

**E-mail through the platform's SMTP service**, with TLS and authentication, for password reset, address verification and the set-up e-mail of new accounts. The sender is the platform's `MAIL_FROM`.

**Events and the console.** Sign-in events are kept 30 days; admin events are kept without request details, so they copy no personal data. The console and the admin API are not routed by the gateway; administrators use Keycloak's administration tool inside the container (`kcadm.sh`), reached over SSH to the host (`docs/operations.md`).

**Plain HTTP to Keycloak inside the host.** The web app and the CMS reach Keycloak's token and key endpoints at `http://keycloak:8080` on the platform's service network, like every other service-to-service call there; browsers only see the public issuer, which production requires to be HTTPS. Until now production refused that internal call, which the end-to-end sign-in check found.

## Consequences

- A staff member who loses the authenticator app is reset by an administrator removing the one-time-code credential in Keycloak; the next sign-in sets up a new one.
- Development keeps `STAFF_SECOND_FACTOR=off` and the development realm, so the synthetic staff sign in with a password; the production stack check proves the second factor end to end.
- The first group administrator of a new installation is created by hand until the handoff documentation adds a procedure (M8.8).
