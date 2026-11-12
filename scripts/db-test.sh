#!/usr/bin/env bash
# Database test suite. Builds a throwaway database from nothing, proves every
# migration applies, rolls back and re-applies cleanly, then runs the SQL tests
# in db/tests (each in a transaction that is rolled back) and a concurrency test
# with two real sessions. The development database is never touched.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

TEST_DB=pythagoras_test
psql_su() { docker compose exec -T -u postgres postgres psql -X -v ON_ERROR_STOP=1 -q "$@"; }
migrate() {
  docker compose run --rm --no-TTY --entrypoint /bin/sh db-migrate -c "
    export DATABASE_URL=\"postgres://pyth_migrator:\$(cat /run/secrets/pg_migrator_password)@postgres:5432/$TEST_DB?sslmode=disable\"
    $1" 2>&1 | grep -v '^ *Container ' || true
}

echo "== creating $TEST_DB from scratch"
psql_su -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB WITH (FORCE)"
psql_su -d postgres -c "CREATE DATABASE $TEST_DB OWNER pyth_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' LOCALE 'C.UTF-8'"
psql_su -d "$TEST_DB" -v dbname="$TEST_DB" -f /opt/pythagoras/db/bootstrap/database.sql

dbmate="dbmate --migrations-dir /db/migrations --migrations-table meta.schema_migrations --no-dump-schema"
count=$(ls db/migrations/*.sql | wc -l)

echo "== migrations: up, roll back all $count, up again"
out=$(migrate "$dbmate up && for i in \$(seq 1 $count); do $dbmate rollback || exit 1; done && $dbmate up && $dbmate status")
echo "$out" | grep -E "Applied:|Rolled back:|Error|error|pending" | sed 's/ in [0-9.]*m*s$//' | sort | uniq -c | sed 's/^ */   /'
if echo "$out" | grep -qi "error"; then
  echo "$out"
  echo "not ok - migrations"
  exit 1
fi
applied=$(echo "$out" | grep -c '^\[X\]' || true)
if [[ "$applied" -ne "$count" ]]; then
  echo "$out"
  echo "not ok - expected $count applied migrations, found $applied"
  exit 1
fi
echo "ok - $count migrations apply, roll back and re-apply cleanly"

failures=0
log=$(mktemp)
for f in db/tests/[0-9]*.sql; do
  # Results arrive as notices on stderr; query output on stdout is discarded.
  set +e
  psql_su -d "$TEST_DB" -f "/opt/pythagoras/$f" 2>&1 >/dev/null | sed -E 's/^psql:[^ ]+ NOTICE:  //; s/^NOTICE:  //' | tee -a "$log"
  rc=${PIPESTATUS[0]}
  set -e
  if (( rc != 0 )); then
    failures=$((failures + 1))
  fi
done

echo "# concurrency"
set +e
bash scripts/db-test-concurrency.sh "$TEST_DB" | tee -a "$log"
rc=${PIPESTATUS[0]}
set -e
(( rc == 0 )) || failures=$((failures + 1))

# The concurrency test left committed synthetic data behind: back it up and
# prove the backup restores to an identical database.
echo "# backup and restore"
set +e
{ DB_NAME=$TEST_DB bash scripts/db-backup.sh && DB_NAME=$TEST_DB bash scripts/db-restore-check.sh; } | tee -a "$log"
rc=${PIPESTATUS[0]}
set -e
(( rc == 0 )) || failures=$((failures + 1))
docker compose run --rm --no-TTY --entrypoint sh db-backup -c "rm -f /backups/${TEST_DB}-*" >/dev/null 2>&1 || true

psql_su -d postgres -c "DROP DATABASE $TEST_DB WITH (FORCE)"

passed=$(grep -c '^ok - ' "$log" || true)
rm -f "$log"
if (( failures > 0 )); then
  echo "database: FAILED in $failures file(s); $passed checks passed before the failures"
  exit 1
fi
echo "database: all $passed checks passed"
