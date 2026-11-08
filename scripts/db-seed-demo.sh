#!/usr/bin/env bash
# Loads the demo data on top of the development seed: classes, timetables,
# children, grades, stock, spending, invoices and a full club (db/seeds/demo.sql).
# Synthetic only, and only for the local development database. The end-to-end
# tests expect the plain development seed, so run them before loading this.
# scripts/db-reset-test-data.sh removes every order, so run this again after it.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

DB=${DB_NAME:-pythagoras}
if [[ "$DB" != "pythagoras" ]]; then
  echo "db-seed-demo: refusing to seed '$DB'; the demo data is only for the local 'pythagoras' database" >&2
  exit 1
fi

docker compose exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/pg_migrator_password)" psql -X -q -tA -v ON_ERROR_STOP=1 -h 127.0.0.1 -U pyth_migrator -d pythagoras -f /opt/pythagoras/db/seeds/demo.sql'
