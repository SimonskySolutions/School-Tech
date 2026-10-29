#!/usr/bin/env bash
# API integration tests against the real stack: starts PostgreSQL, Keycloak and
# the API (waiting until healthy), makes sure the development seed is loaded,
# then runs apps/api/test/integration with real Keycloak tokens.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose up -d --wait postgres keycloak api >/dev/null 2>&1 || {
  docker compose ps
  echo "api-integration: the stack did not become healthy" >&2
  exit 1
}
bash scripts/db-migrate.sh up >/dev/null 2>&1
bash scripts/db-seed.sh >/dev/null
docker compose run --rm --no-TTY workspace pnpm --filter @pythagoras/api test:integration 2>&1 | grep -v '^ *Container '
exit "${PIPESTATUS[0]}"
