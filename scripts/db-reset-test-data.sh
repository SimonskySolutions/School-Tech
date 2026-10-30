#!/usr/bin/env bash
# Development only: removes all orders, bookings, payments and provider events,
# and the schools the onboarding tests add, from the local database
# (db/seeds/reset-test-data.sql), so the test suites can run again. The seeded
# schools, catalogue, people and sessions are kept.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose exec -T -u postgres postgres psql -X -q -d pythagoras -f /opt/pythagoras/db/seeds/reset-test-data.sql
