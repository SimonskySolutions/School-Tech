#!/usr/bin/env bash
# API and worker integration tests against the real stack: starts PostgreSQL,
# Redis, Keycloak, the API and the worker (waiting until healthy), makes sure
# the development seed is loaded, then runs apps/api/test/integration with real
# Keycloak tokens. Orders and bookings from earlier runs are removed first
# (db-reset-test-data.sh); test outbox events are removed afterwards.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose up -d --wait postgres redis keycloak api worker cms >/dev/null 2>&1 || {
  docker compose ps
  echo "api-integration: the stack did not become healthy" >&2
  exit 1
}
bash scripts/db-migrate.sh up >/dev/null 2>&1
bash scripts/db-seed.sh >/dev/null
bash scripts/db-reset-test-data.sh

set +e
docker compose run --rm --no-TTY workspace pnpm --filter @pythagoras/api test:integration 2>&1 | grep -v '^ *Container '
status=${PIPESTATUS[0]}
set -e

docker compose exec -T -u postgres postgres psql -X -q -d pythagoras \
  -c "DELETE FROM integration.outbox_event WHERE aggregate_type = 'test.worker'" >/dev/null
exit "$status"
