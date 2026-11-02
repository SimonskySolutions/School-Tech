# 0033 Production topology: one host, provider-neutral

Date: 2026-11-02 · Status: Accepted

## Context

The brief asks for a documented production deployment: containerised gateway, web, API, worker, CMS, identity provider, PostgreSQL, Redis, object storage and a one-off migration job, with health checks, restricted permissions, secrets outside images and the repository, backups, restoration, disaster recovery and the limits of the first topology. Decided on 2026-11-02: the hosting provider, the group's domain and the off-site backup storage are to be decided later; the recovery targets are **at most 5 minutes of data lost and 4 hours to restore service** after losing the server.

## Decision

**One Linux host with Docker Compose, nothing tied to a provider.** `compose.production.yaml` runs every service from a pinned image built by CI; it needs a Linux server with Docker, a firewall open on 80 and 443 only, and an EU location. Any provider that offers that will do; managed PostgreSQL remains acceptable later if it supports row-level security, our roles and EU hosting (`docs/operations.md`).

**Images, not source trees.** Every service runs from an image: the platform's own (API and worker share one, web, CMS, migration job, gateway with its configuration, Keycloak built with `kc.sh build` and the Pythagoras theme) and pinned upstream images by digest. Images contain no secrets; secrets are files mounted at `/run/secrets`. Containers run as unprivileged users where the image allows, with `no-new-privileges`, all capabilities dropped unless one is needed, and read-only root filesystems where the software permits.

**Three networks.** The gateway alone is published (80, 443). The applications sit on an internal network with the gateway; PostgreSQL, PgBouncer, Redis and Garage on a data network that the gateway cannot reach. No data service is published to the host.

**Encrypted everywhere.** HTTPS at the gateway with HSTS; TLS on every connection to PostgreSQL, PgBouncer and Redis, from a private certificate authority made on the host; PgBouncer in transaction mode in front of PostgreSQL (the platform sets its request context with `SET LOCAL`, which transaction pooling keeps).

**Releases.** A release pulls the images, runs the migration job, which applies the platform's migrations and stops the release if one fails, and then replaces the applications. The CMS applies its own generated migrations on start. Production rolls forward only, and migrations stay compatible with the previous application version (expand, then contract), so rolling back an image never needs a database rollback.

**Backups to any S3-compatible EU storage.** pgBackRest archives the write-ahead log continuously and takes a full backup weekly and a differential daily, encrypted before it leaves the host, into an S3-compatible bucket in a separate account. Documents are copied to the same kind of storage before each database backup. Until the storage is chosen, the whole cycle is proven against a local stand-in bucket. Continuous archiving meets the 5-minute target; the restore drill measures the time to a working platform against the 4-hour target.

**Monitoring with Prometheus and Alertmanager.** Exporters for the host, PostgreSQL, PgBouncer and Redis, and the platform's own metrics (queue depths, outbox backlog, failed messages, backup age, last restore check). Alerts go by e-mail through the same SMTP service as notifications. No hosted monitoring service, so no data leaves the host for it.

**Placeholder names.** Until the domain exists the configuration uses `example.bg` names, and the local proof of the production stack uses `*.pythagoras.test` with certificates from a local authority. `docs/operations.md` lists the DNS records to create.

## Consequences

- The host is a single point of failure, accepted for three schools with the targets above. The growth path (database replica, Redis replica, more application instances) is in `docs/operations.md`.
- Choosing a provider and storage later means filling in `.env.production`, the secret files and DNS; no code or Compose change.
- CI builds every image and starts the production stack from nothing on each push, so a clean start is tested, not assumed.
- Tool choices and pinned versions are recorded in the step that introduces each (pgBackRest, PgBouncer, Prometheus, Alertmanager and the exporters).
