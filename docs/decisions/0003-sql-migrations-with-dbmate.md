# 0003 Plain SQL migrations applied with dbmate

Date: 2026-10-29 · Status: Accepted

## Context

The schema depends on features that ORM migration generators handle poorly or not at all: row-level security policies, security-definer functions, column-level grants, exclusion constraints, partitioned tables and triggers. The migration job must run as a one-off container during releases, before new application code starts.

## Decision

- Write migrations as plain SQL, reviewed like code, in `db/migrations/`.
- Apply them with dbmate 2.34.1 (`ghcr.io/amacneil/dbmate:2.34.1`, digest `sha256:3298bdfcb651af608e06d2e13ae12398c4056e5326d38ef31885973d83248d9c`). Each migration runs in one transaction; the history table is `meta.schema_migrations`.
- Migrations connect as `pyth_migrator`, whose sessions act as the schema owner `pyth_owner`.
- Every migration has a `migrate:down` section for development. In production we roll forward: a failed release is fixed by a new migration, never by running `down` against live data.
- Migrations must stay compatible with the previous application release (expand, then contract), so the application can be rolled back without rolling back the database.

## Consequences

- The NestJS backend will use a query builder or ORM for queries only, against the schema these migrations define.
- dbmate is also published on npm, so the migration job can later run from the backend image if that proves simpler.
