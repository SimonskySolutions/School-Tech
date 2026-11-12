#!/bin/bash
# Applies the bootstrap: roles, the application database, the Keycloak and
# CMS databases, and database-level settings. Runs inside the postgres container as
# the postgres user over the local socket. Idempotent: the initdb hook runs it
# on a new volume, and scripts/db-bootstrap.sh re-applies it to an existing one.
set -euo pipefail

psql=(psql -X -v ON_ERROR_STOP=1 --username postgres --no-password)

"${psql[@]}" --dbname postgres -f /opt/pythagoras/db/bootstrap/cluster.sql

"${psql[@]}" --dbname postgres <<'SQL'
SELECT 'CREATE DATABASE pythagoras OWNER pyth_owner TEMPLATE template0 ENCODING ''UTF8'' LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8'' LOCALE ''C.UTF-8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pythagoras') \gexec
SELECT 'CREATE DATABASE keycloak OWNER pyth_keycloak TEMPLATE template0 ENCODING ''UTF8'' LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8'' LOCALE ''C.UTF-8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak') \gexec
REVOKE ALL ON DATABASE keycloak FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE keycloak TO pyth_keycloak;
SELECT 'CREATE DATABASE pythagoras_cms OWNER pyth_cms TEMPLATE template0 ENCODING ''UTF8'' LOCALE_PROVIDER builtin BUILTIN_LOCALE ''C.UTF-8'' LOCALE ''C.UTF-8'''
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'pythagoras_cms') \gexec
REVOKE ALL ON DATABASE pythagoras_cms FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE pythagoras_cms TO pyth_cms;
SQL

"${psql[@]}" --dbname keycloak <<'SQL'
ALTER SCHEMA public OWNER TO pyth_keycloak;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL

"${psql[@]}" --dbname pythagoras_cms <<'SQL'
ALTER SCHEMA public OWNER TO pyth_cms;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
SQL

"${psql[@]}" --dbname pythagoras -v dbname=pythagoras -f /opt/pythagoras/db/bootstrap/database.sql
