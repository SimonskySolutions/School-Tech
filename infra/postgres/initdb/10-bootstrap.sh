#!/bin/bash
# Runs once, when the data volume is empty (docker-entrypoint-initdb.d).
# Creates the roles and the application database, then applies database-level
# settings. Schema objects come from migrations, not from here.
set -euo pipefail

psql=(psql -X -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --no-password)

"${psql[@]}" --dbname postgres -f /opt/pythagoras/db/bootstrap/cluster.sql

"${psql[@]}" --dbname postgres <<'SQL'
SELECT 'CREATE DATABASE pythagoras OWNER pyth_owner TEMPLATE template0 ENCODING ''UTF8'' LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8'' LOCALE ''C.UTF-8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pythagoras') \gexec
SQL

"${psql[@]}" --dbname pythagoras -v dbname=pythagoras -f /opt/pythagoras/db/bootstrap/database.sql
