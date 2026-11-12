# 0015 Gateway, production images and continuous integration

Date: 2026-10-29 · Status: Accepted

## Gateway

- **Caddy 2.11.7** (`caddy:2.11.7-alpine`, digest `sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f`) is the only public entry point. It routes by host name and adds a request id that the API keeps in its logs and audit context.
- **Development** (`infra/gateway/Caddyfile`, plain HTTP on `127.0.0.1:53000`): `portal.pythagoras.localhost` and `*.pythagoras.localhost` go to the web app, `api.pythagoras.localhost` exposes only health checks, `localhost` redirects to the portal, unknown hosts get 421. The portal has one canonical address so sign-in cookies always belong to it.
- **Production** (`infra/gateway/Caddyfile.production`): automatic HTTPS. School website domains get certificates **on demand**, but Caddy first asks the API (`GET /internal/tls/allowed`) whether the name is a verified domain of a live website. Adding a school website is therefore data in the platform, not a gateway change, and nobody can make the gateway request certificates for names we do not own. `/internal` is never routed from outside; the Keycloak admin console is not exposed.
- The gateway runs read-only with all capabilities dropped except binding ports, and removes `Server` headers.

## Production images

- `infra/images/api.Dockerfile` builds one image for the **API and the worker** (different commands). `infra/images/web.Dockerfile` builds the Next.js standalone server.
- Multi-stage builds from the pinned Node 24 image; dependencies installed from the lockfile only; the runtime stage contains compiled output and production dependencies, no source, tests or secrets (`.dockerignore`). Code is owned by root and the process runs as `node`.
- Images are built in CI on every push. Publishing to a registry, signing and vulnerability scanning come with production deployment (M8).

## Continuous integration

- GitHub Actions (`.github/workflows/ci.yml`) runs on every push and on pull requests into `Dev` and `main`, with read-only repository permissions. Third-party actions are pinned to full commit hashes: `actions/checkout` 7.0.1, `actions/setup-node` 7.1.0, `pnpm/action-setup` 6.1.0.
- Three parallel jobs: code (type check, lint, format, unit tests, builds); images (build both, check the user); stack (start everything in Docker and run the database, Redis, identity, API and worker integration, end-to-end sign-in and gateway suites).
- CI uses freshly generated throwaway secrets and synthetic data only. On failure it prints the service logs.

## Consequences

- The web app is no longer published on its own port; open `http://portal.pythagoras.localhost:53000`.
- On Linux hosts the generated secret files must be readable by the container users (CI does `chmod a+r secrets/*`). Docker Desktop on Windows does not enforce these permissions.
