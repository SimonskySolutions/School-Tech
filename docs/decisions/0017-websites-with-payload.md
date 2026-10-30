# 0017 School websites with Payload CMS

Date: 2026-10-30 · Status: Accepted

## Context

Every school, and the group, has a public website (the brief names Payload). Adding a school must stay configuration only (M3): a new school's website must appear without code or deploys. The platform already knows websites and their domains (`org.website`, `org.website_domain`, `org.resolve_hostname`, ADR 0011); content (pages, news, images) is edited by staff and is public by nature.

## Decision

- **Payload 3 as its own service, `apps/cms`.** A Next.js 16 app that hosts only Payload's admin UI and REST API, pinned to Payload 3.91.0 (released 2026-10-15, older than the minimum release age; supports Next.js 16.3.3+). It is separate from the portal (`apps/web`) so that editor tooling, its dependencies and its sessions never share a process with the family portal.
- **Its own database and role.** Payload's schema is managed by Payload (drizzle), not by our SQL migrations, so it lives in its own database `pythagoras_cms`, owned by the role `pyth_cms` (secret `pg_cms_password`), exactly like Keycloak's. `pyth_cms` cannot connect to `pythagoras`; the platform roles cannot connect to `pythagoras_cms`. In development Payload creates its tables on start; for production, Payload's migration files are generated and applied as a release step (M8).
- **One tenant per website.** Payload's multi-tenant plugin scopes pages and media to a `websites` collection whose `key` equals `org.website.cms_tenant_key`. A new school's website is a new tenant: data, not code.
- **No personal data in the CMS.** It holds public content only. Children's names, photos of children and anything from the platform's personal data never go into it (consent for photos is a separate, later decision).
- **Public pages are rendered by the web app.** For a request on a website host, `apps/web` resolves the host with `org.resolve_hostname` (only verified domains of live websites, ADR 0011) and reads that tenant's published pages from the CMS REST API over the internal network. Drafts are never served: the public read rule in Payload returns published versions only. Website hosts are served by `apps/web`; the CMS admin has its own host (`cms.pythagoras.localhost` in development).
- **Editors' sign-in.** In M3.5 editors use Payload's own accounts, created by an administrator (a seeded development editor). Before production, editors sign in through Keycloak (OpenID Connect) so staff have one account and leavers are removed in one place; this is an open item, not built yet.

## Consequences

- One more service, database and backup target: `scripts/db-backup.sh` must include `pythagoras_cms` before production (M8), and the restore check must cover it.
- The CMS brings a large dependency tree (Payload, its admin UI, image handling). It is isolated in `apps/cms`, and its install scripts are approved one by one in `allowBuilds`.
- Websites keep working if the CMS is down only if pages are cached; caching is a later step. Until then a CMS outage shows the website's "temporarily unavailable" page, never an error page with internals.
