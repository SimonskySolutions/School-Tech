#!/usr/bin/env bash
# Takes a logical backup of the development database into the pg_backups volume.
#   scripts/db-backup.sh
#   scripts/db-backup.sh --list
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

if [[ "${1:-}" == "--list" ]]; then
  exec docker compose exec -T postgres sh -c 'ls -lh /backups/*.dump 2>/dev/null || echo "no backups yet"'
fi
docker compose run --rm --no-TTY -e DB_NAME="${DB_NAME:-pythagoras}" db-backup 2>&1 | { grep -v '^ *Container ' || true; }
