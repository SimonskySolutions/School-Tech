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

```bash
bash scripts/api-integration-test.sh
```

```bash
bash scripts/web-e2e-test.sh
```

```bash
bash scripts/gateway-test.sh
```

To try it in a browser: open `http://portal.pythagoras.localhost:53000`, choose **Sign in**, and use one of the accounts below with the password in `secrets/keycloak_dev_user_password`.

To call the API by hand as a seeded person, get a token from the development test client and pass it as a bearer token:

```bash
TOKEN=$(curl -s -X POST http://localhost:58080/realms/pythagoras/protocol/openid-connect/token -d grant_type=password -d client_id=pythagoras-dev-tests -d username=anna.ivanova@pythagoras.test --data-urlencode "password=$(cat secrets/keycloak_dev_user_password)" | python -c "import sys, json; print(json.load(sys.stdin)['access_token'])")
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:53001/me
```

| Service | Host address | Notes |
| --- | --- | --- |
| PostgreSQL 18.6 | `127.0.0.1:55432`, databases `pythagoras` and `keycloak` | Override with `POSTGRES_HOST_PORT`. Superuser only via `docker compose exec -u postgres postgres psql` |
| Redis 8.10.2 | `127.0.0.1:56379` | Override with `REDIS_HOST_PORT`. Users `pyth_queue`, `pyth_health`, `pyth_admin` |
| Keycloak 26.8.1 | `http://localhost:58080`, realm `pythagoras` | Override with `KEYCLOAK_HOST_PORT`. Admin console: `/admin`, user `admin`, password in `secrets/keycloak_admin_password` |
| Gateway (Caddy) | `http://portal.pythagoras.localhost:53000` | Override with `GATEWAY_HOST_PORT`. The front door: the portal, school sites (`school-a.pythagoras.localhost:53000` …) and `api.pythagoras.localhost:53000` (health checks only). `localhost:53000` redirects to the portal. Browsers resolve `*.localhost` without any setup |
| Web app (development mode) | through the gateway only | Sign in with any seeded account below. Reloads within about 2 seconds of a file change |
| Worker | no port | Runs the API service's compiled output as `pyth_worker` / `pyth_queue`; healthy while its heartbeat file is fresh. Logs: `docker compose logs -f worker` |
| API (watch mode) | `http://localhost:53001` | Override with `API_HOST_PORT`. `/health/live`, `/health/ready` are public; every other route needs a Keycloak access token. Starts after the one-off `deps` service has installed dependencies |

### Code toolchain

Node.js and pnpm run inside the `workspace` container (ADR 0012); nothing needs installing on the host.

```bash
bash scripts/pnpm.sh install
```

```bash
bash scripts/check.sh
```

`scripts/pnpm.sh` passes any pnpm command through, for example `bash scripts/pnpm.sh --filter @pythagoras/api test`. Dependencies and build output live in the `ws_*` volumes; `docker compose down -v` removes them together with the databases, so prefer removing only those volumes when you want a clean reinstall.

**Known development gotcha:** the API's watch compiler notices changed files but not a newly created folder under `apps/api/src`. After adding a folder, run `docker compose restart api` (the worker picks up the new output by itself). The same restart helps when the API log shows `EADDRINUSE` after a change: the watcher's new process could not take the port, and the old code keeps answering.

### Background jobs

| Queue | Job | When | What it does |
| --- | --- | --- | --- |
| `events` | one per outbox event | as soon as it is committed (relay polls every second) | Runs the handlers registered for the event type. At-least-once delivery, 8 attempts with exponential backoff; kept 7 days when done, 30 days when failed. Handlers today: `commerce.order_line.cancelled` issues the family's credit for a cancelled lunch day |
| `maintenance` | `audit.ensure-partitions` | 03:00 UTC on the 1st of each month, and at worker start | Creates audit-log partitions three months ahead |
| `maintenance` | `integration.purge-inbound-payloads` | 03:30 UTC daily | Reduces processed provider webhook payloads older than 90 days to identifiers |
| `maintenance` | `commerce.expire-reservations` | every minute | Expires unpaid orders past their reservation time and releases their seats |
| (no queue) | payment events | polls every second | Applies verified provider webhooks stored in `integration.inbound_event`, oldest first. They stay in PostgreSQL because provider payloads can contain personal data |

An outbox event whose payload looks like personal data is never sent to Redis: it stays unpublished with `last_error` explaining why. Find such events with `SELECT event_type, last_error FROM integration.outbox_event WHERE published_at IS NULL AND last_error IS NOT NULL` (as the superuser); they indicate a programming error to fix. Retention jobs that delete personal data are not scheduled until the data protection officer approves retention policies.

If you add a role or a secret to an existing installation, apply it with `bash scripts/db-bootstrap.sh` (idempotent; the first-start hook only runs on an empty volume).

### Lunch menus and dietary needs (ADR 0020)

- Menus: `/school-life/menus` (School Life, principals and kitchens publish; other staff read). Saving a day replaces its menu; tick every allergen a dish contains. The development seed fills each lunch day with a synthetic weekly menu (peanuts on Thursdays).
- Dietary needs: parents use "Dietary needs" next to each child on the home page; School Life and principals see `/school-life/dietary`, unverified first, and School Life verifies there. The kitchen list shows "(not yet verified)" until then, and lists children whose declared allergen is on their lunch first.
- Who read a child's dietary data: `SELECT occurred_at, actor_person_id, resource FROM audit.access_log WHERE subject_person_id = '<child>' ORDER BY occurred_at DESC` (needs `audit.read`, or the superuser).

### Individual lessons (ADR 0022)

- Selling lessons: on the school's set-up page add a lessons offering with the price "per package of lessons" and the number of lessons (1 for single lessons). Parents buy packages on the booking page.
- Teachers, rooms and times: `/schools/<id>/lessons` (linked from the offering, from home for school staff, and from the School Life section). Add teachers and rooms, give each weekly hours, then "Create lesson times" for a date range and length; it fills the hours the teacher and the room share and leaves out anything that would clash, so running it again is safe.
- Families book on "Lessons" next to each child. Cancelling at least 24 hours before returns the lesson to the package; later, it counts as used. Unused lessons do not expire and are not refunded automatically.

### Club eligibility and attendance (ADR 0021)

- Who may take a club: on the school's set-up page, under each club, "Who may take it" (grades as the school names them, and ages in whole years on the day). Bookings already made stay when the rules change. An age rule needs the child's date of birth on their record.
- Registers (`/school-life/registers`): once a meeting has started, teachers, principals, school administrators and School Life mark each child Attended or Absent; corrections are allowed and recorded. Parents see it under "Clubs and attendance".

### Websites and the CMS (ADR 0017)

- School and group websites: `http://school-a.pythagoras.localhost:53000` (also `school-b`, `school-c`, and `pythagoras.localhost` for the group). They show the website's published CMS pages, or a start page built from the platform when there is none.
- The CMS admin: `http://cms.pythagoras.localhost:53000/admin`, "Sign in with your Pythagoras account" (ADR 0019): `admin@pythagoras.test` is a CMS administrator and `schoollife@pythagoras.test` an editor, with the development users' password (`secrets/keycloak_dev_user_password`). Who may edit is the client role `cms-admin` or `cms-editor` of the Keycloak client `pythagoras-cms` (Keycloak admin console: Users → the person → Role mapping); which websites an editor works on is set in the CMS. Without a role, sign-in is refused. Password sign-in (the seeded `editor@pythagoras.test`) works only because the development stack sets `CMS_PASSWORD_LOGIN=true`; never set it in production. If you add this to an existing installation: `bash scripts/dev-secrets.sh`, `bash scripts/keycloak-reload-realm.sh`, then `docker compose up -d --force-recreate keycloak cms`. The development seed creates the four websites as tenants and School A's start page; drafts are never shown on the websites.
- The CMS has its own database `pythagoras_cms` (role `pyth_cms`, secret `secrets/pg_cms_password`) and session secret (`secrets/cms_payload_secret`). If you add the CMS to an existing installation: `bash scripts/dev-secrets.sh`, `docker compose up -d --force-recreate postgres`, `bash scripts/db-bootstrap.sh`, then `docker compose up -d cms`.
- A new school's website: on the school's set-up page, "Create the school's website". It answers on `http://<school code>.pythagoras.localhost:53000` once the school is active. The API adds its space in the CMS with the platform key (`secrets/cms_platform_api_key`, shared by the API and the CMS).
- The CMS log shows many `watch error … No such file or directory` lines from the development file watcher; they are harmless.

## Development data and accounts

`scripts/db-seed.sh` loads `db/seeds/development.sql`: synthetic data only, idempotent, and refused for any database other than the local `pythagoras`. It contains one company, **Testing Company** (placeholder name), billing **School A**, **School B** and **School C**; their websites under `*.pythagoras.localhost`; lunch, chess, robotics and tuition offerings with per-school prices; the next 20 school days of lunch and eight weeks of club sessions.

All accounts share one generated password, stored in `secrets/keycloak_dev_user_password`. Sign in through the web app at `http://portal.pythagoras.localhost:53000`.

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

The realm file `infra/keycloak/realm/pythagoras-realm.json` is a development realm: it contains these users and the `pythagoras-dev-tests` password-grant client. It is imported only when the realm does not exist yet; after editing it, run `bash scripts/keycloak-reload-realm.sh` (deletes the realm and restarts Keycloak, which imports it again; synthetic users keep their ids, accounts created since are removed).

**Accounts for new people (ADR 0016).** A group administrator creates a registered person's sign-in account with `POST /admin/people/<person id>/account`. The API uses the `pythagoras-provisioning` service account (secret `secrets/keycloak_provisioning_client_secret`, from `scripts/dev-secrets.sh`). In development the answer contains a one-time temporary password, which the person must change at first sign-in; it is shown only once. Production must set `ACCOUNT_SETUP=email` and configure SMTP in the realm (M7). If the API log says `PROVISIONING_CLIENT_SECRET not set`, accounts cannot be created.

## Payments

Development uses the **development payment provider** (ADR 0010): no money moves, and every page that shows such a payment says so. A purchase goes: `/services` in the portal → the provider's page at `http://api.pythagoras.localhost:53000/dev-payments/checkout/…` (pay or decline) → back to `/orders/<id>`, which shows "Paid" only after the worker has applied the signed webhook (a second or two).

Useful checks, as the superuser (`docker compose exec -u postgres postgres psql -d pythagoras`):

- Events not applied: `SELECT provider, event_type, processing_status, attempts, last_error FROM integration.inbound_event WHERE processing_status IN ('received', 'failed') ORDER BY received_at;`. A `failed` event (for example an amount mismatch) needs a person: check it with the provider, then fix the payment by hand.
- Remove all test orders and bookings, and the schools the onboarding tests add (codes starting `test-`, with their offerings, sessions, staff and "Test company" billing entities), keeping the seeded schools, catalogue and people: `bash scripts/db-reset-test-data.sh` (refuses unless every person is synthetic). The identity, API integration and end-to-end scripts run it first.

**Switching to Stripe (test mode)**, when the account exists:

1. In the Stripe dashboard (test mode), create a webhook endpoint for `https://<API_HOST>/webhooks/stripe` with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`.
2. Put the secret key and the endpoint's signing secret in the secret store as files, and give the API `STRIPE_SECRET_KEY_FILE` and `STRIPE_WEBHOOK_SECRET_FILE`, plus `PAYMENT_PROVIDER=stripe`. The API refuses to start with `stripe` and no keys; the development checkout pages then answer 404.
3. Locally, forward events with the Stripe CLI (`stripe listen --forward-to localhost:53001/webhooks/stripe`) and use its signing secret.
4. Run one payment with a Stripe test card, then resend the same event from the dashboard: the second delivery must be stored as a duplicate and change nothing. Only then mark Stripe "validated" in the integration register.

## Production images and CI

```bash
docker build -f infra/images/api.Dockerfile -t pythagoras-api .
```

```bash
docker build -f infra/images/web.Dockerfile -t pythagoras-web .
```

The API image also runs the worker: `docker run pythagoras-api node dist/worker/main.js`. Both images run as the unprivileged `node` user and refuse unsafe production settings at start-up (for example, the web app requires HTTPS addresses when `NODE_ENV=production`).

GitHub Actions (`.github/workflows/ci.yml`) runs the code checks, builds both images, and runs every suite against the full stack on each push and on pull requests into `Dev` and `main` (ADR 0015).

### Real domains for school websites (ADR 0018)

On the school's set-up page, an administrator adds the domain (for example `www.school-d.bg`) and gives the school's IT contact two DNS changes:

1. **Proof of control:** the TXT record shown on the page, name `_pythagoras-verify.<domain>`, value `pythagoras-site-verification=<token>`.
2. **Pointing the domain at the platform:** an A/AAAA record (or a CNAME) for the domain to the production gateway.

The worker checks pending domains every minute (each at most every five minutes) and marks the domain verified when the TXT record is found; "Check again now" asks for the next run. After 14 days without the record a domain becomes "failed"; fix the record and check again. Once verified, and the school's website is live, the website answers on the domain and the gateway obtains its HTTPS certificate on the first visit. **Keep the TXT record:** verified domains are checked again every day. If it is missing, the set-up page shows a warning with the date the domain will stop; after three days without it the domain stops answering until the record is back and the domain is checked again.

### Production gateway

`infra/gateway/Caddyfile.production` serves HTTPS. It needs `ACME_EMAIL`, `AUTH_HOST` and `API_HOST`, and DNS records pointing the identity, API and every school domain at the gateway host, with ports 80 and 443 open for certificate issuance. School domains get certificates only once the platform lists them as verified domains of a live website.

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
