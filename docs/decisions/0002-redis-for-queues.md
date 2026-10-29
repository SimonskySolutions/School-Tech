# 0002 Redis 8.10 as a queue store, separate from caching

Date: 2026-10-29 · Status: Accepted

## Context

BullMQ needs Redis 6.2 or newer and requires `maxmemory-policy noeviction`: if Redis evicts a queue key, jobs are silently lost. A cache needs the opposite policy (evict the least recently used keys). One Redis instance cannot be configured correctly for both.

The current stable Redis Open Source release is 8.10.2 (2026-09-17). Since version 8, Redis Open Source is licensed under a choice of AGPLv3, RSALv2 or SSPLv1.

## Decision

- Run one Redis instance, `redis`, dedicated to BullMQ queues: `noeviction`, append-only file with `fsync` every second, plus periodic RDB snapshots.
- Image `redis:8.10.2-trixie`, pinned by digest `sha256:97ec88159e6d7cfb5ddef9015386087d58a912de80112f06ebdfa78fa5989901`.
- If the application later needs a cache, it gets a second instance (`redis-cache`, `allkeys-lru`, no persistence) rather than sharing this one.
- Redis holds no personal data. Job payloads carry identifiers only; the worker reads personal data from PostgreSQL under its own access rules.
- Access uses ACL users with passwords; the `default` user is disabled.

## Consequences

- PostgreSQL stays the system of record. The transactional outbox in PostgreSQL decides which events exist; Redis only schedules their delivery, so a lost Redis volume delays work but loses no business records.
- We run Redis unmodified as a separate service. If Pythagoras is ever distributed to third parties, the Redis licence choice needs legal review; Valkey (BSD licence, BullMQ-compatible) is the fallback.
