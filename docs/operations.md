# Operations

Status: data services and the identity provider (milestones M0 and M1.1). Application services are added in later milestones.

## Local development

Requirements: Docker Desktop with Compose v2, and Git Bash (Windows) or any POSIX shell. Node.js is not needed yet; tests that need it run in a pinned container.

```bash
bash scripts/dev-secrets.sh
```

```bash
docker compose up -d
```

```bash
bash scripts/db-migrate.sh up
```

```bash
bash scripts/db-seed.sh
```

```bash
bash scripts/db-test.sh
```

```bash
bash scripts/redis-test.sh
```

```bash
bash scripts/identity-test.sh
```

| Service | Host address | Notes |
| --- | --- | --- |
| PostgreSQL 18.6 | `127.0.0.1:55432`, databases `pythagoras` and `keycloak` | Override with `POSTGRES_HOST_PORT`. Superuser only via `docker compose exec -u postgres postgres psql` |
| Redis 8.10.2 | `127.0.0.1:56379` | Override with `REDIS_HOST_PORT`. Users `pyth_queue`, `pyth_health`, `pyth_admin` |
| Keycloak 26.8.1 | `http://localhost:58080`, realm `pythagoras` | Override with `KEYCLOAK_HOST_PORT`. Admin console: `/admin`, user `admin`, password in `secrets/keycloak_admin_password` |

If you add a role or a secret to an existing installation, apply it with `bash scripts/db-bootstrap.sh` (idempotent; the first-start hook only runs on an empty volume).

## Development data and accounts

`scripts/db-seed.sh` loads `db/seeds/development.sql`: synthetic data only, idempotent, and refused for any database other than the local `pythagoras`. It contains one company, **Testing Company** (placeholder name), billing **School A**, **School B** and **School C**; their websites under `*.pythagoras.localhost`; lunch, chess, robotics and tuition offerings with per-school prices; the next 20 school days of lunch and eight weeks of club sessions.

All accounts share one generated password, stored in `secrets/keycloak_dev_user_password`. Sign in at `http://localhost:58080/realms/pythagoras/account`, or through the web app once it exists.

| Account | Role | Sees |
| --- | --- | --- |
| `ceo@pythagoras.test` | CEO | All schools; no health data |
| `admin@pythagoras.test` | Group administrator | All schools; configuration |
| `finance@pythagoras.test` | Group finance | Finance across schools |
| `schoollife@pythagoras.test` | School Life coordinator | Services, bookings and dietary needs across schools |
| `dpo@pythagoras.test` | Data protection officer | Privacy records, audit log |
| `principal.a@pythagoras.test`, `principal.b@…`, `principal.c@…` | Principal | Their own school |
| `kitchen.a@pythagoras.test` | Kitchen, School A | Bookings and dietary needs at School A |
| `teacher.b@pythagoras.test` | Teacher, School B | School B enrolments and bookings |
| `anna.ivanova@pythagoras.test` | Parent | Mila (School A, peanut allergy) and Boris (School C) |
| `hristo.georgiev@pythagoras.test` | Parent | Kalina (School B) |
| `teodora.marinova@pythagoras.test` | Parent, request pending | Nothing until a principal verifies the relationship |
| `unlinked@pythagoras.test` | None | Signs in to Keycloak, but has no person record: the platform must refuse it |

The realm file `infra/keycloak/realm/pythagoras-realm.json` is a development realm: it contains these users and the `pythagoras-dev-tests` password-grant client. It is imported only when the realm does not exist yet; to reload it after editing, remove the realm in the admin console (or reset the `keycloak` database) and restart Keycloak.

## Identity provider in production (to do in M8)

- `start --optimized` with a pre-built image, behind the gateway with `KC_PROXY_HEADERS=xforwarded`, on its own host name (for example `auth.<domain>`), TLS terminated at the gateway.
- A user-free realm export: no development users, no `pythagoras-dev-tests` client, production redirect URIs only.
- Multi-factor sign-in required for staff through the realm's authentication flow.
- SMTP configured so that e-mail verification and password reset work.
- Login events are kept 30 days (`eventsExpiration`); admin events without request details, so no personal data is copied into them.
- Back up the `keycloak` database together with `pythagoras` (same cluster, same backup job).

Passwords are in `secrets/` (git-ignored), one file per role. For an administrative session as the superuser (local socket only):

```bash
docker compose exec -T -u postgres postgres psql -d pythagoras -c "SELECT now()"
```

Data lives in Docker volumes (`pg_data`, `redis_data`, `pg_backups`), not in the project folder. This matters here: the project folder is synced by OneDrive, and database files and backups must never be synced to a personal cloud.

## Migrations

- `bash scripts/db-migrate.sh up` applies pending migrations; `status` lists them.
- Migrations run as `pyth_migrator` with a 10 s lock timeout, so a migration that would block live traffic fails instead of waiting.
- `scripts/db-test.sh` proves on every run that all migrations apply to an empty database, roll back completely and re-apply.
- **Production rolls forward only.** If a migration fails, the transaction rolls back and the release stops; fix it with a new migration. Never run `rollback` against production data.
- **Expand, then contract.** A migration must work with the application version before it, so the application can be rolled back without touching the database. Remove old columns in a later release.

## Backups and restore

```bash
bash scripts/db-backup.sh
```

```bash
bash scripts/db-restore-check.sh
```

- `db-backup.sh` writes a compressed `pg_dump` (custom format, zstd) and a SHA-256 checksum to the `pg_backups` volume, as `pyth_backup`, and keeps the newest 7 (`BACKUP_KEEP`).
- `db-restore-check.sh` verifies the checksum, restores into a scratch database in one transaction, and compares the row count of every table with the source. The test suite runs it on synthetic data every time.
- **Container images are not backups**, and neither is the Docker volume: losing the host loses both.

### Restoring the development database

1. Stop anything that writes: `docker compose stop` for application services (none yet).
2. `docker compose exec -u postgres postgres psql -d postgres -c "DROP DATABASE pythagoras WITH (FORCE)"`
3. Recreate it with the `CREATE DATABASE` statement in `infra/postgres/initdb/10-bootstrap.sh`.
4. `docker compose exec -u postgres postgres pg_restore --dbname pythagoras --single-transaction /backups/<file>.dump`
5. `docker compose exec -u postgres postgres psql -d pythagoras -v dbname=pythagoras -f /opt/pythagoras/db/bootstrap/database.sql`
6. `bash scripts/db-migrate.sh status` must show no pending migrations, or apply them.

### Production (required before go-live, not yet built)

- **Continuous archiving with point-in-time recovery**: pgBackRest (or WAL-G) with `archive_mode = on`, a full backup weekly, differential daily, WAL archived continuously to encrypted, off-site object storage in the EU, in a separate account from the database host.
- **Retention**: at least 30 days of point-in-time recovery; monthly logical dumps kept per the DPO-approved retention policy.
- **Restore drills**: monthly automated restore to a scratch host with the row-count check; quarterly full disaster-recovery rehearsal with timings recorded.
- **Targets to agree with the business**: recovery point objective (data that may be lost) and recovery time objective (time to restore service). With WAL archiving, the RPO is typically under 5 minutes.
- **Redis**: no backup is needed for correctness. PostgreSQL's outbox is the source of truth; after losing Redis, the worker re-enqueues unpublished outbox events and expiry jobs from PostgreSQL. RDB snapshots and the AOF on the volume cover ordinary restarts.

## Upgrades

- **PostgreSQL minor release** (quarterly): change the image tag and digest in `compose.yaml`, `docker compose up -d postgres`. No data change.
- **PostgreSQL major release** (19 is due late 2026): wait for 19.1 or 19.2; test with `pg_upgrade --link` on a restored copy (the volume is mounted at `/var/lib/postgresql` for this), run the full test suite, then upgrade with a backup taken immediately before.
- **Redis**: change the tag and digest, restart; run `scripts/redis-test.sh`.
- **Rotating a password**: write the new value to the secret file, re-run `db/bootstrap/cluster.sql` as the superuser (it applies `ALTER ROLE … PASSWORD` from the secrets), restart the services that use that role. For Redis, restart the container: the ACL file is regenerated from the secrets on start.

## Production configuration differences

| Area | Development | Production |
| --- | --- | --- |
| Transport security | No TLS inside the Compose network | TLS for every PostgreSQL and Redis connection; `hostssl` in `pg_hba.conf`; Redis `tls-port` only |
| Storage | Docker volume | Encrypted disk; managed PostgreSQL is acceptable if it supports RLS, the roles above, and EU hosting |
| Memory settings | Sized for a laptop | `shared_buffers` ~25 % of RAM, `effective_cache_size` ~50–75 % |
| Connections | Direct | PgBouncer in transaction mode in front of PostgreSQL (`SET LOCAL` context is compatible) |
| Secrets | Files in `secrets/` | Host secret store or the platform's secret manager; never in images or the repository |
| Logs | Docker `local` driver | Shipped to central logging; PostgreSQL never logs query parameters, so logs carry no personal data from queries |
| Redis host setting | Docker Desktop default | `vm.overcommit_memory = 1` on the host, as Redis recommends for background saves |

## Availability limits of the initial topology

One PostgreSQL and one Redis instance on one host is a single point of failure: a host outage stops the platform until it is restored from backup. It is a reasonable start for three schools if the recovery targets above are accepted. The growth path:

1. PostgreSQL streaming replica on a second host (`wal_level = replica` is already set) with managed failover (Patroni) or a managed PostgreSQL service with high availability.
2. Redis replica with Sentinel, or a managed Redis-compatible service.
3. Application instances (API, worker) scale horizontally behind the gateway; they keep no local state.
4. Reporting moves to a read replica once report queries affect daily work.

## Monitoring checklist (to implement with the application)

- PostgreSQL: connections per role, replication lag, longest transaction, lock waits (logged), `pg_stat_statements` top queries, autovacuum, disk usage, backup age, last successful restore check.
- Redis: memory against `maxmemory` (with `noeviction`, a full Redis rejects writes), AOF rewrite status, connected clients, queue depths and failed jobs.
- Audit log partitions: `audit.ensure_partitions()` must run monthly (worker job); alert if fewer than two future partitions exist.
- Data subject requests approaching `due_at`.
