#!/usr/bin/env bash
# End-to-end tests: starts the whole development stack (waiting until healthy),
# makes sure the seed is loaded and earlier test orders are gone, then signs
# synthetic users in through the real Keycloak login form, checks what the web
# app shows, and buys and pays through it with the development payment provider.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose up -d --wait postgres redis keycloak api worker web >/dev/null 2>&1 || {
  docker compose ps
  echo "web-e2e: the stack did not become healthy" >&2
  exit 1
}
bash scripts/db-migrate.sh up >/dev/null 2>&1
bash scripts/db-seed.sh >/dev/null
bash scripts/db-reset-test-data.sh
docker compose run --rm --no-TTY workspace pnpm --filter @pythagoras/web test:e2e 2>&1 | grep -v '^ *Container '
exit "${PIPESTATUS[0]}"
