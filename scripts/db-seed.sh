#!/usr/bin/env bash
# Loads the synthetic development seed into the development database, as the
# schema owner (pyth_migrator). Refuses to run against any other database.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

DB=${DB_NAME:-pythagoras}
if [[ "$DB" != "pythagoras" ]]; then
  echo "db-seed: refusing to seed '$DB'; the development seed is only for the local 'pythagoras' database" >&2
  exit 1
fi

docker compose exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/pg_migrator_password)" psql -X -q -tA -v ON_ERROR_STOP=1 -h 127.0.0.1 -U pyth_migrator -d pythagoras -f /opt/pythagoras/db/seeds/development.sql'
