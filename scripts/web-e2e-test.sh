#!/usr/bin/env bash
# End-to-end sign-in tests: starts the whole development stack (waiting until
# healthy), makes sure the seed is loaded, then signs synthetic users in through
# the real Keycloak login form and checks what the web app shows.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose up -d --wait postgres keycloak api web >/dev/null 2>&1 || {
  docker compose ps
  echo "web-e2e: the stack did not become healthy" >&2
  exit 1
}
bash scripts/db-migrate.sh up >/dev/null 2>&1
bash scripts/db-seed.sh >/dev/null
docker compose run --rm --no-TTY workspace pnpm --filter @pythagoras/web test:e2e 2>&1 | grep -v '^ *Container '
exit "${PIPESTATUS[0]}"
