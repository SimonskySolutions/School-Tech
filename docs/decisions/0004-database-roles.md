# 0004 Least-privilege database roles

Date: 2026-10-29 · Status: Accepted

## Decision

Each process connects with its own role and receives only the privileges it needs. No application process connects as a superuser or as the schema owner.

| Role | Login | Used by | Can do | Cannot do |
| --- | --- | --- | --- | --- |
| `pyth_owner` | No | Owns all schemas and objects | Everything on its objects | Log in |
| `pyth_migrator` | Yes | The one-off migration job | Act as `pyth_owner`: DDL and data migrations | Bypass RLS on other owners' objects; superuser actions |
| `pyth_api` | Yes | NestJS API | Read and write business tables through RLS, in the signed-in person's context | DDL, `TRUNCATE`, bypass RLS, read audit or webhook payloads directly |
| `pyth_worker` | Yes | Background workers | System-level reads and writes on the tables its jobs need (payments, outbox, retention) | DDL, `TRUNCATE`, tables outside its jobs |
| `pyth_reporting` | Yes | Future BI and exports | Read-only on `reporting` views, which apply RLS | Read base tables, write anything |
| `pyth_backup` | Yes | Backup jobs | Read all data for `pg_dump` (`pg_read_all_data`, `BYPASSRLS`) | Write anything |

Role-level limits:

- `pyth_api`: 15 s statement timeout, 5 s lock timeout, 30 s idle-in-transaction timeout, 80 connections.
- `pyth_worker`: 120 s statement timeout, 10 s lock timeout, 60 s idle-in-transaction timeout, 20 connections.
- `pyth_migrator`: 10 s lock timeout, so a migration fails fast instead of queuing behind live traffic; 2 connections.
- `pyth_reporting`: read-only transactions, 60 s statement timeout, 5 connections.

The `postgres` superuser can only connect through the local socket inside the container (peer authentication). Remote superuser connections are rejected in `pg_hba.conf`.

## Privileged access

- `pyth_owner` (through `pyth_migrator`) bypasses RLS because it owns the tables. Tables do not use `FORCE ROW LEVEL SECURITY`, so data migrations can run without a person context. Migrations are reviewed for this reason.
- `pyth_worker` acts as the system, not as a person. Its policies are explicit per table, and its writes are audited with `db_user = pyth_worker` and the job name in `app.actor`.
- `pyth_backup` reads everything, because a backup must. Its password is only available to the backup job, and backup files are treated as personal data (ADR 0006).
- Break-glass access as `postgres` is manual, logged by PostgreSQL, and recorded in the operations log.

## Consequences

Passwords are generated per environment, kept outside the repository, and passed to containers as Docker secrets. Rotating one is `ALTER ROLE … PASSWORD` plus a restart of the process that uses it.
