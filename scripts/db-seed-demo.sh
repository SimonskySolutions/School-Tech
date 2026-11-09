#!/usr/bin/env bash
# Loads the demo data on top of the development seed: classes, timetables,
# children, grades, stock, spending, invoices and a full club (db/seeds/demo.sql),
# the names Pythagoras Sofia, Varna and Academy with their own website addresses,
# and the websites' pages in the CMS (scripts/cms-demo-content.mjs).
# Synthetic only, and only for the local development database.
#
# The end-to-end tests expect the plain development seed. scripts/db-seed.sh
# puts the School A, B and C names and addresses back, and
#   scripts/db-seed-demo.sh --remove-websites
# deletes the demo pages so the CMS brings back its development start pages.
# scripts/db-reset-test-data.sh removes every order, so run this again after it.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

DB=${DB_NAME:-pythagoras}
if [[ "$DB" != "pythagoras" ]]; then
  echo "db-seed-demo: refusing to seed '$DB'; the demo data is only for the local 'pythagoras' database" >&2
  exit 1
fi

if ! docker compose exec -T cms true 2>/dev/null; then
  echo "db-seed-demo: the cms container is not running; start it with 'docker compose up -d --wait cms'" >&2
  exit 1
fi

if [[ "${1:-}" == "--remove-websites" ]]; then
  docker compose exec -T cms node /workspace/scripts/cms-demo-content.mjs remove
  # The CMS adds the development start pages again when it starts.
  docker compose restart cms >/dev/null
  echo "db-seed-demo: demo website pages removed; the CMS is restarting with its development pages"
  exit 0
fi

docker compose exec -T postgres sh -c \
  'PGPASSWORD="$(cat /run/secrets/pg_migrator_password)" psql -X -q -tA -v ON_ERROR_STOP=1 -h 127.0.0.1 -U pyth_migrator -d pythagoras -f /opt/pythagoras/db/seeds/demo.sql'
docker compose exec -T cms node /workspace/scripts/cms-demo-content.mjs
