# 0001 PostgreSQL 18.6 on the official Debian image

Date: 2026-10-29 · Status: Accepted

## Context

PostgreSQL holds every durable record. On 2026-10-29 the current stable release is 18.6 (released 2026-08-13; 18.5 was withdrawn). PostgreSQL 19 is at release candidate 1 and is not yet generally available. Version 18 is supported until November 2030.

## Decision

- Use `postgres:18.6-trixie`, pinned by digest `sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4`.
- Use the Debian (glibc) variant, not Alpine (musl): collation and ICU behaviour on glibc matches managed PostgreSQL services, which keeps sorting and unique indexes on text stable if the database moves.
- Mount the volume at `/var/lib/postgresql`, as the PostgreSQL 18 image requires, so a later `pg_upgrade --link` to 19 is possible.
- Data checksums are on (the PostgreSQL 18 default for new clusters); a test verifies it.
- Install only the extensions we use: `btree_gist` (exclusion constraints on time ranges) and `pg_stat_statements` (query statistics).

## Consequences

- Moving to PostgreSQL 19 is a planned upgrade after 19.1 or 19.2, not a default. The procedure is in `docs/operations.md`.
- Minor releases (quarterly) are applied by changing the tag and digest, then restarting.
