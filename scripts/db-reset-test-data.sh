#!/usr/bin/env bash
# Development only: removes all orders, bookings, payments and provider events,
# and the schools the onboarding tests add, from the local database
# (db/seeds/reset-test-data.sql), so the test suites can run again. The seeded
# schools, catalogue, people and sessions are kept, and so are all Keycloak
# users except the ones the tests created.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose exec -T -u postgres postgres psql -X -q -d pythagoras -f /opt/pythagoras/db/seeds/reset-test-data.sql

# Sign-in accounts the tests created for those people (user names "test-…").
docker compose exec -T keycloak bash -c '
  kcadm=/opt/keycloak/bin/kcadm.sh
  $kcadm config credentials --server http://127.0.0.1:8080 --realm master --user admin \
    --password "$(tr -d "\r\n" < /run/secrets/keycloak_admin_password)" >/dev/null 2>&1
  $kcadm get users -r pythagoras -q search=test- -q max=500 --fields id,username --format csv --noquotes |
    while IFS=, read -r id username; do
      case "$username" in test-*@pythagoras.test) $kcadm delete "users/$id" -r pythagoras ;; esac
    done
'
