# 0019 CMS editors sign in with Keycloak

Date: 2026-10-30 · Status: Accepted

## Context

Website editors used Payload's own accounts (ADR 0017): a second password per person, and a leaver had to be removed in two places. Staff already have a Keycloak account for the portal (ADR 0009, 0016).

## Decision

- **A Keycloak client for the CMS.** `pythagoras-cms` is a confidential client using the authorization-code flow with PKCE, redirecting only to the CMS's `/sso/callback`. Its two client roles say who may edit: `cms-admin` (all websites, editors) and `cms-editor` (the websites assigned in the CMS). A mapper puts them into the ID token as `cms_roles`. Its secret is a Docker secret (`keycloak_cms_client_secret`).
- **Sign-in.** The CMS's login page offers "Sign in with your Pythagoras account". `/sso/login` starts the flow, keeping state, nonce and the PKCE verifier in a short-lived encrypted cookie; `/sso/callback` exchanges the code and checks state, nonce, issuer, audience and signature, as the portal does (ADR 0014).
- **Keycloak decides who is an editor; the CMS decides which websites.** On every sign-in the CMS finds the editor by their Keycloak subject (or, the first time, by e-mail), creates them if needed, and sets their CMS role from `cms_roles`. Someone without a CMS role is refused and no account is created; removing the role or the Keycloak account takes effect at the next sign-in, and existing sessions end within their 8-hour lifetime. Which websites an editor works on stays in the CMS (the multi-tenant plugin).
- **A normal Payload session.** After the callback the CMS records a session on the editor and signs Payload's own token with Payload's secret, so Payload's admin, API and sign-out work unchanged (sign-out ends the session). The answer is a small page that moves on to `/admin` itself, so the editor's strict-same-site session cookie is sent on the first page.
- **No passwords for people outside development.** Password sign-in is refused unless `CMS_PASSWORD_LOGIN=true`, which only the development stack sets (for the seeded editor and the tests). The platform's service account keeps its API key (ADR 0017).

## Consequences

- One account per person for the portal and the CMS; leavers are removed in Keycloak.
- The CMS now depends on Keycloak for sign-in, like the portal.
- Signing out of the CMS does not end the Keycloak session (the person stays signed in to the portal); ending both together is a later improvement.
