#!/usr/bin/env bash
# Proves a backup can be restored: verifies the checksum of the newest (or the
# given) dump, restores it into a scratch database, compares the row count of
# every table with the source, and drops the scratch database.
#   scripts/db-restore-check.sh [dump-file-name]
#   DB_NAME=pythagoras_test scripts/db-restore-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

SOURCE_DB=${DB_NAME:-pythagoras}
CHECK_DB=pythagoras_restore_check
psql_su() { docker compose exec -T -u postgres postgres psql -X -q -v ON_ERROR_STOP=1 "$@"; }
in_pg() { docker compose exec -T -u postgres postgres "$@"; }

dump=${1:-$(in_pg sh -c "ls -1t /backups/${SOURCE_DB}-*.dump 2>/dev/null | head -1 | xargs -r basename")}
[[ -n "$dump" ]] || { echo "no backup found for $SOURCE_DB; run scripts/db-backup.sh first"; exit 1; }
echo "== restoring $dump into $CHECK_DB"

in_pg sh -c "cd /backups && sha256sum --quiet -c '$dump.sha256'" && echo "ok - checksum matches"

psql_su -d postgres -c "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)"
psql_su -d postgres -c "CREATE DATABASE $CHECK_DB OWNER pyth_owner TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' LOCALE 'C.UTF-8'"
# The dump carries schemas, extensions, objects, grants and data; database-level
# privileges are reapplied from the bootstrap afterwards.
in_pg pg_restore --dbname "$CHECK_DB" --exit-on-error --single-transaction "/backups/$dump"
psql_su -d "$CHECK_DB" -v dbname="$CHECK_DB" -f /opt/pythagoras/db/bootstrap/database.sql >/dev/null
echo "ok - restored in a single transaction without errors"

if diff <(psql_su -d "$SOURCE_DB" -tA -f /opt/pythagoras/db/ops/row_counts.sql) \
        <(psql_su -d "$CHECK_DB" -tA -f /opt/pythagoras/db/ops/row_counts.sql) >/dev/null; then
  tables=$(psql_su -d "$CHECK_DB" -tA -f /opt/pythagoras/db/ops/row_counts.sql | wc -l)
  rows=$(psql_su -d "$CHECK_DB" -tA -f /opt/pythagoras/db/ops/row_counts.sql | awk -F= '{s += $2} END {print s}')
  echo "ok - all $tables tables match the source ($rows rows)"
else
  echo "not ok - row counts differ from the source"
  exit 1
fi

rls=$(psql_su -d "$CHECK_DB" -tAc "SELECT count(*) FROM pg_class WHERE relrowsecurity")
policies=$(psql_su -d "$CHECK_DB" -tAc "SELECT count(*) FROM pg_policies")
[[ "$rls" -gt 0 && "$policies" -gt 0 ]] && echo "ok - row-level security and $policies policies restored"

psql_su -d postgres -c "DROP DATABASE $CHECK_DB WITH (FORCE)"
echo "restore check: passed"
