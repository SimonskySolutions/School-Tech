# Pythagoras platform

Central management platform for the Pythagoras school group: one system for every school, website, family and payment.

**Current state:** the PostgreSQL and Redis foundation (M0), the Keycloak identity service with development data (M1.1), and the code workspace (M1.2), API sign-in with per-person database access (M1.3), web sign-in with a role-aware home page (M1.4), and the background worker (M1.5) are built and tested. Open `http://localhost:53000` after starting the stack. The gateway and CI come next.

Layout: `apps/api` (NestJS), `apps/web` (Next.js), `packages/shared` (shared types and money helpers), `db/` (migrations, seed, tests), `infra/` (service configuration), `docs/`. See [docs/implementation-plan.md](docs/implementation-plan.md).

## Start

Requires Docker Desktop and a POSIX shell (Git Bash on Windows).

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

Development accounts and where their password lives: [docs/operations.md](docs/operations.md#development-data-and-accounts).

## Test

```bash
bash scripts/check.sh
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

## Documentation

- [Architecture](docs/architecture.md), including changes to the proposed design
- [Data model](docs/data-model.md)
- [Decisions](docs/decisions/README.md)
- [Operations](docs/operations.md): backups, restore, upgrades, production differences
- [Integration register](docs/integration-register.md)

All data in development and tests is synthetic. Payment processing stays in test mode during development.
