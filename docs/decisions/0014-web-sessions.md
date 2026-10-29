# 0014 Web sign-in and sessions

Date: 2026-10-29 · Status: Accepted

## Decision

- **Server-side sign-in (backend-for-frontend).** The Next.js server runs the OpenID Connect authorization code flow with PKCE (S256), `state` and `nonce`, using `openid-client` 6.8 as the confidential client `pythagoras-web`. The browser only ever sees Keycloak's login page and a one-time code.
- **Tokens never reach browser JavaScript.** Access and refresh tokens are kept in one cookie, encrypted and authenticated with AES-256-GCM (JWE `dir`, key from the `web_session_secret` secret). The cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` whenever the app is served over HTTPS. The ID token is validated at sign-in and then discarded.
- **Short-lived access, rolling refresh.** Access tokens live 5 minutes; the Next.js proxy refreshes them shortly before expiry and rewrites the cookie. The session ends when Keycloak's 30-minute idle limit or 10-hour maximum is reached, or on sign-out.
- **Sign-out** is a `POST` with an origin check. It ends the Keycloak session through the back channel (the refresh token stops working at once) and deletes the cookie.
- **The API decides who you are.** After sign-in the web server calls `GET /me`; a Keycloak account with no linked person gets an explanation page and no session.
- **Redirects after sign-in** accept only relative paths on this site, so the sign-in link cannot be abused as an open redirect.
- Browser-facing Keycloak URLs use the public issuer (`http://localhost:58080` in development); token, key and logout calls use the internal URL (`http://keycloak:8080`).

## Consequences

- A session is stateless on the web side. If someone copied a session cookie before sign-out, its access token keeps working for at most 5 minutes; refreshing fails once Keycloak has ended the session. A server-side session store can replace the cookie later without changing the sign-in flow.
- Development runs over plain HTTP, so the cookie is not marked `Secure` and `openid-client` is told to allow HTTP. Both are refused when `NODE_ENV=production`.
