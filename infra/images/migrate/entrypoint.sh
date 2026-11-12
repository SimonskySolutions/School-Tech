#!/bin/sh
# Builds the connection from settings and the migrator's secret file, so the
# password is in no image, command line or Compose file, then runs dbmate.
#   DB_HOST (postgres)  DB_PORT (5432)  DB_NAME (pythagoras)
#   DB_PASSWORD_FILE (/run/secrets/pg_migrator_password)
#   DB_SSLMODE (verify-full) and DB_SSLROOTCERT for the certificate authority
set -eu

password=$(tr -d '\r\n' < "${DB_PASSWORD_FILE:-/run/secrets/pg_migrator_password}")
encoded=$(printf '%s' "$password" | od -An -tx1 | tr -d ' \n' | sed 's/../%&/g')
params="sslmode=${DB_SSLMODE:-verify-full}"
if [ -n "${DB_SSLROOTCERT:-}" ]; then params="$params&sslrootcert=$DB_SSLROOTCERT"; fi

export DATABASE_URL="postgres://pyth_migrator:${encoded}@${DB_HOST:-postgres}:${DB_PORT:-5432}/${DB_NAME:-pythagoras}?${params}"
exec dbmate --migrations-dir /db/migrations --migrations-table meta.schema_migrations \
  --no-dump-schema --wait --wait-timeout 120s "$@"
