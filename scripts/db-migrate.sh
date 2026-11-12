#!/usr/bin/env bash
# Runs dbmate against a database as pyth_migrator.
#   scripts/db-migrate.sh up                 # apply pending migrations
#   scripts/db-migrate.sh status             # list applied and pending migrations
#   DB_NAME=pythagoras_test scripts/db-migrate.sh rollback
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
exec docker compose run --rm --no-TTY -e DB_NAME="${DB_NAME:-pythagoras}" db-migrate "${@:-up}"
