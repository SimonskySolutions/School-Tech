# Pythagoras platform

Central management platform for the Pythagoras school group: one system for every school, website, family and payment.

**Current state:** the PostgreSQL and Redis foundation (M0) and the Keycloak identity service with development data (M1.1) are built and tested. The API, worker and web app come next. See [docs/implementation-plan.md](docs/implementation-plan.md).

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
bash scripts/db-test.sh
```

```bash
bash scripts/redis-test.sh
```

```bash
bash scripts/identity-test.sh
```

## Documentation

- [Architecture](docs/architecture.md), including changes to the proposed design
- [Data model](docs/data-model.md)
- [Decisions](docs/decisions/README.md)
- [Operations](docs/operations.md): backups, restore, upgrades, production differences
- [Integration register](docs/integration-register.md)

All data in development and tests is synthetic. Payment processing stays in test mode during development.
