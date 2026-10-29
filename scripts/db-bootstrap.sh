#!/usr/bin/env bash
# Re-applies the database bootstrap (roles, databases, privileges) to a running
# cluster, then reloads pg_hba.conf. Use after adding a role or secret, or to
# rotate passwords from the files in ./secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
docker compose exec -T -u postgres postgres bash /opt/pythagoras/db/bootstrap/apply.sh
docker compose exec -T -u postgres postgres psql -X -q -tAc "SELECT 'pg_hba.conf reloaded: ' || pg_reload_conf()"
