#!/bin/bash
# Logical backup of one database, run inside the db-backup tools container.
# Writes a compressed custom-format dump and its SHA-256 checksum to /backups
# (a Docker volume, never the repository or a cloud-synced folder) and keeps
# the newest $BACKUP_KEEP dumps.
set -euo pipefail

# The volume is created root-owned; prepare it, then continue as postgres.
if [[ $(id -u) -eq 0 ]]; then
  chown postgres:postgres /backups
  chmod 700 /backups
  exec gosu postgres "$0" "$@"
fi

db=${DB_NAME:-pythagoras}
keep=${BACKUP_KEEP:-7}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/backups/${db}-${stamp}.dump"

export PGPASSFILE=$(mktemp)
trap 'rm -f "$PGPASSFILE"' EXIT
printf 'postgres:5432:%s:pyth_backup:%s\n' "$db" "$(cat /run/secrets/pg_backup_password)" > "$PGPASSFILE"
chmod 600 "$PGPASSFILE"

umask 077
pg_dump --host postgres --username pyth_backup --dbname "$db" --no-password \
        --format custom --compress zstd:6 --file "$file.partial"
mv "$file.partial" "$file"
sha256sum "$file" | sed 's#/backups/##' > "$file.sha256"

# A dump that cannot be listed is not a backup.
pg_restore --list "$file" > /dev/null

echo "backup: $(basename "$file") ($(du -h "$file" | cut -f1))"

ls -1t /backups/${db}-*.dump 2>/dev/null | tail -n +$((keep + 1)) | while read -r old; do
  rm -f "$old" "$old.sha256"
  echo "removed old backup: $(basename "$old")"
done
