#!/bin/sh
# Writes PgBouncer's user list from the secret files of the two roles it pools,
# on memory-only storage, then starts PgBouncer. It needs the passwords
# themselves to sign in to PostgreSQL with SCRAM on the clients' behalf. The
# monitoring role (M8.6) may only read PgBouncer's own statistics.
set -eu

umask 077
mkdir -p /run/pgbouncer
quote() { tr -d '\r\n' < "$1" | sed 's/"/""/g'; }
{
  printf '"pyth_api" "%s"\n' "$(quote /run/secrets/pg_api_password)"
  printf '"pyth_worker" "%s"\n' "$(quote /run/secrets/pg_worker_password)"
  if [ -f /run/secrets/pg_monitor_password ]; then
    printf '"pyth_monitor" "%s"\n' "$(quote /run/secrets/pg_monitor_password)"
  fi
} > /run/pgbouncer/userlist.txt

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
