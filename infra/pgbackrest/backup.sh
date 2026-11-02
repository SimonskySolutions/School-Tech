#!/bin/bash
# The backup service (M8.5, ADR 0035), in the PostgreSQL image as "postgres":
#   pythagoras-backup run           the container's command: pgBackRest's TLS
#                                   server for the database's log, and the schedule
#   pythagoras-backup full|diff     a database backup now (the documents first)
#   pythagoras-backup documents     copies the documents now
#   pythagoras-backup pgbackrest …  pgBackRest with the repository's settings
#                                   (info, check, verify, restore …)
#   pythagoras-backup rclone …      rclone with the remotes "documents",
#                                   "offsite" (raw) and "sealed" (decrypting)
#   pythagoras-backup health        the container's health check
#
# Schedule (UTC): a full backup on BACKUP_FULL_DAY (ISO weekday, 7 = Sunday)
# or when the newest full is a week old, a differential every other day, both
# at BACKUP_HOUR; the documents every DOCUMENTS_COPY_INTERVAL seconds and
# before each database backup. On the first start, a full backup at once.
set -euo pipefail

stanza=pythagoras
state=/tmp/pythagoras-backup
hour=${BACKUP_HOUR:-1}
full_day=${BACKUP_FULL_DAY:-7}
documents_every=${DOCUMENTS_COPY_INTERVAL:-300}
keep_days=${BACKUP_DOCUMENTS_KEEP_DAYS:-35}
retry_after=1800
documents_bucket=${STORAGE_BUCKET:-pythagoras-documents}

log() { echo "backup: $*"; }

# Settings for pgBackRest and rclone from the environment and the secrets.
# Secrets go to files in /tmp (memory only) or to this process's environment.
prepare() {
  umask 077
  mkdir -p "$state" /tmp/pgbackrest/conf.d /tmp/pgbackrest/tls /tmp/pgbackrest/lock
  install -m 600 /run/secrets/tls_backup_key /tmp/pgbackrest/tls/server.key
  install -m 644 /run/secrets/tls_backup_crt /tmp/pgbackrest/tls/server.crt
  printf '[global]\nrepo1-s3-key-secret=%s\nrepo1-cipher-pass=%s\n' \
    "$(cat /run/secrets/backup_s3_secret_key)" "$(cat /run/secrets/backup_cipher_pass)" \
    >/tmp/pgbackrest/conf.d/secrets.conf

  local port=${BACKUP_S3_PORT:-443} style=${BACKUP_S3_URI_STYLE:-path}
  export PGBACKREST_CONFIG=/etc/pgbackrest/repository.conf
  export PGBACKREST_CONFIG_INCLUDE_PATH=/tmp/pgbackrest/conf.d
  export PGBACKREST_REPO1_S3_ENDPOINT=${BACKUP_S3_ENDPOINT:?}
  export PGBACKREST_REPO1_STORAGE_PORT=$port
  export PGBACKREST_REPO1_S3_REGION=${BACKUP_S3_REGION:?}
  export PGBACKREST_REPO1_S3_BUCKET=${BACKUP_S3_BUCKET:?}
  export PGBACKREST_REPO1_S3_KEY=${BACKUP_S3_KEY_ID:?}
  export PGBACKREST_REPO1_S3_URI_STYLE=$style

  # The documents bucket, through the backup's read-only key.
  export RCLONE_CONFIG_DOCUMENTS_TYPE=s3 RCLONE_CONFIG_DOCUMENTS_PROVIDER=Other
  export RCLONE_CONFIG_DOCUMENTS_ENDPOINT=${STORAGE_ENDPOINT:-http://garage:3900}
  export RCLONE_CONFIG_DOCUMENTS_REGION=${STORAGE_REGION:-garage}
  export RCLONE_CONFIG_DOCUMENTS_FORCE_PATH_STYLE=true
  export RCLONE_CONFIG_DOCUMENTS_ACCESS_KEY_ID=${BACKUP_STORAGE_ACCESS_KEY_ID:?}
  RCLONE_CONFIG_DOCUMENTS_SECRET_ACCESS_KEY=$(cat /run/secrets/storage_backup_secret_access_key)
  export RCLONE_CONFIG_DOCUMENTS_SECRET_ACCESS_KEY
  # The off-site storage, raw, and the same with rclone's encryption on top:
  # names and contents are encrypted before they leave the host.
  export RCLONE_CONFIG_OFFSITE_TYPE=s3 RCLONE_CONFIG_OFFSITE_PROVIDER=Other
  export RCLONE_CONFIG_OFFSITE_ENDPOINT="https://$BACKUP_S3_ENDPOINT:$port"
  export RCLONE_CONFIG_OFFSITE_REGION=$BACKUP_S3_REGION
  export RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE=$([[ $style == path ]] && echo true || echo false)
  export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
  export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID=$BACKUP_S3_KEY_ID
  RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY=$(cat /run/secrets/backup_s3_secret_key)
  export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY
  export RCLONE_CONFIG_SEALED_TYPE=crypt
  export RCLONE_CONFIG_SEALED_REMOTE="offsite:$BACKUP_S3_BUCKET/documents"
  export RCLONE_CONFIG_SEALED_FILENAME_ENCRYPTION=standard
  export RCLONE_CONFIG_SEALED_DIRECTORY_NAME_ENCRYPTION=true
  RCLONE_CONFIG_SEALED_PASSWORD=$(rclone obscure - </run/secrets/backup_documents_pass)
  RCLONE_CONFIG_SEALED_PASSWORD2=$(rclone obscure - </run/secrets/backup_documents_salt)
  export RCLONE_CONFIG_SEALED_PASSWORD RCLONE_CONFIG_SEALED_PASSWORD2
  # Every remote is in the environment; the (empty) file only keeps rclone quiet.
  mkdir -p /tmp/rclone && touch /tmp/rclone/rclone.conf
  export RCLONE_CONFIG=/tmp/rclone/rclone.conf RCLONE_CACHE_DIR=/tmp/rclone
  # A private authority for the storage (the local stand-in); public ones otherwise.
  if [[ -n ${BACKUP_S3_CA_FILE:-} ]]; then
    export PGBACKREST_REPO1_STORAGE_CA_FILE=$BACKUP_S3_CA_FILE RCLONE_CA_CERT=$BACKUP_S3_CA_FILE
  fi
}

# Copies new document versions; whatever disappeared from the bucket is moved
# aside under removed/<time>, kept as long as the database backups.
documents() {
  local stamp cutoff
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  cutoff=$(date -u -d "-$keep_days days" +%Y%m%dT%H%M%SZ)
  rclone sync "documents:$documents_bucket" sealed:current --backup-dir "sealed:removed/$stamp" \
    --stats 0 --log-level NOTICE
  rclone lsf --dirs-only sealed:removed 2>/dev/null | tr -d / | while read -r old; do
    if [[ "$old" < "$cutoff" ]]; then
      rclone purge "sealed:removed/$old" && log "documents removed before $cutoff purged ($old)"
    fi
  done
  date -u +%s >"$state/documents.last"
}

backup() { # full|diff
  documents
  pgbackrest --stanza="$stanza" --type="$1" backup
  date -u +%s >"$state/backup.last"
  log "$1 backup done"
}

# The type of database backup due now, or nothing.
due() {
  local info now last last_full
  info=$(pgbackrest --stanza="$stanza" --output=json info)
  now=$(date -u +%s)
  last=$(jq '[.[0].backup[].timestamp.stop] | max // 0' <<<"$info")
  last_full=$(jq '[.[0].backup[] | select(.type == "full") | .timestamp.stop] | max // 0' <<<"$info")
  if [[ "$last_full" == 0 ]]; then echo full; return; fi
  if (( 10#$(date -u +%H) < hour )) || [[ $(date -u -d "@$last" +%F) == $(date -u +%F) ]]; then return; fi
  if [[ $(date -u +%u) == "$full_day" ]] || (( now - last_full >= 7 * 86400 )); then echo full; else echo diff; fi
}

run() {
  prepare
  pgbackrest server &
  local server=$! next_documents=0 failed_at=0 type
  trap 'kill "$server" 2>/dev/null; exit 0' TERM INT

  # The stanza is made once and checked on every start; the database's log is
  # accepted from then on. "check" switches to a new log segment and waits for
  # it to arrive in the repository.
  until pgbackrest --stanza="$stanza" stanza-create && pgbackrest --stanza="$stanza" check; do
    log "the repository is not ready; trying again in 30 seconds"
    sleep 30 & wait $!
  done
  if [[ $(pgbackrest --stanza="$stanza" --output=json info | jq '.[0].backup | length') == 0 ]]; then
    log "no backup yet: a full one now"
    until backup full; do sleep 60 & wait $!; done
  fi
  touch "$state/ready"
  log "ready: the log is archived, and backups run at $hour:00 UTC"

  while kill -0 "$server" 2>/dev/null; do
    if (( $(date +%s) >= next_documents )); then
      documents || log "copying the documents failed"
      next_documents=$(( $(date +%s) + documents_every ))
    fi
    if (( $(date +%s) - failed_at >= retry_after )); then
      if type=$(due) && [[ -n "$type" ]]; then
        backup "$type" || { failed_at=$(date +%s); log "the $type backup failed; trying again in $((retry_after / 60)) minutes"; }
      fi
    fi
    sleep 60 & wait $!
  done
  log "the TLS server stopped"
  exit 1
}

case ${1:-run} in
  run) run ;;
  full | diff) prepare; backup "$1" ;;
  documents) prepare; documents; log "documents copied" ;;
  pgbackrest | rclone) prepare; exec "$@" ;;
  health) [[ -f "$state/ready" ]] && PGBACKREST_CONFIG=/etc/pgbackrest/repository.conf pgbackrest server-ping localhost >/dev/null ;;
  *) echo "usage: pythagoras-backup [run|full|diff|documents|pgbackrest …|rclone …|health]" >&2; exit 2 ;;
esac
