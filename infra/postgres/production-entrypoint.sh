#!/bin/bash
# Production PostgreSQL (M8.4): puts the server's certificate and key where the
# server will accept them (PostgreSQL refuses a key that others may read, and
# secret files are mounted readable), then hands over to the official
# entrypoint, which runs the server as the "postgres" user.
set -euo pipefail

install -d -o postgres -g postgres -m 700 /run/postgresql-tls
install -o postgres -g postgres -m 600 /run/secrets/tls_postgres_key /run/postgresql-tls/server.key
install -o postgres -g postgres -m 644 /run/secrets/tls_postgres_crt /run/postgresql-tls/server.crt

exec docker-entrypoint.sh "$@"
