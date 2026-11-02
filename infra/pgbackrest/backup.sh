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
#   pythagoras-backup drill [--time=T|--name=N]
#                                   the restore drill (M8.7): restores to a scratch
#                                   data directory, checks it and measures the time
#   pythagoras-backup restore documents [T]
#   pythagoras-backup restore database [T]
#                                   a lost server's restore (M8.7): the documents
#                                   first, then the database, to the latest moment
#                                   or to T ("2026-11-02 17:00:00+00")
#
# Its measures for monitoring (M8.6) go to $kept/metrics/backup.prom, which the
# host's exporter reads: the newest backup of each type, the last copy of the
# documents, whether the last backup failed and the last restore drill.
#
# Schedule (UTC): a full backup on BACKUP_FULL_DAY (ISO weekday, 7 = Sunday)
# or when the newest full is a week old, a differential every other day, both
# at BACKUP_HOUR; the documents every DOCUMENTS_COPY_INTERVAL seconds and
# before each database backup. On the first start, a full backup at once.
set -euo pipefail

stanza=pythagoras
state=/tmp/pythagoras-backup
# Kept across restarts (the backup_state volume).
kept=/var/lib/pythagoras-backup
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
  # The TLS server's certificate: only the backup service has one.
  if [[ -f /run/secrets/tls_backup_key ]]; then
    install -m 600 /run/secrets/tls_backup_key /tmp/pgbackrest/tls/server.key
    install -m 644 /run/secrets/tls_backup_crt /tmp/pgbackrest/tls/server.crt
  fi
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

  # The documents bucket: through the backup's read-only key, or the API's
  # key when restoring (DOCUMENTS_SECRET_FILE). The drill needs neither.
  if [[ -n ${BACKUP_STORAGE_ACCESS_KEY_ID:-} ]]; then
    export RCLONE_CONFIG_DOCUMENTS_TYPE=s3 RCLONE_CONFIG_DOCUMENTS_PROVIDER=Other
    export RCLONE_CONFIG_DOCUMENTS_ENDPOINT=${STORAGE_ENDPOINT:-http://garage:3900}
    export RCLONE_CONFIG_DOCUMENTS_REGION=${STORAGE_REGION:-garage}
    export RCLONE_CONFIG_DOCUMENTS_FORCE_PATH_STYLE=true
    export RCLONE_CONFIG_DOCUMENTS_ACCESS_KEY_ID=$BACKUP_STORAGE_ACCESS_KEY_ID
    RCLONE_CONFIG_DOCUMENTS_SECRET_ACCESS_KEY=$(cat "${DOCUMENTS_SECRET_FILE:-/run/secrets/storage_backup_secret_access_key}")
    export RCLONE_CONFIG_DOCUMENTS_SECRET_ACCESS_KEY
  fi
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
    --stats 0 --log-level NOTICE || return 1
  rclone lsf --dirs-only sealed:removed 2>/dev/null | tr -d / | while read -r old; do
    if [[ "$old" < "$cutoff" ]]; then
      rclone purge "sealed:removed/$old" && log "documents removed before $cutoff purged ($old)"
    fi
  done
  date -u +%s >"$kept/documents.last"
}

# Functions below are also called in "||" lists, where bash does not stop at a
# failing command, so each step's result is checked.
backup() { # full|diff
  documents || return 1
  if pgbackrest --stanza="$stanza" --type="$1" backup; then
    echo 0 >"$kept/backup.failed"
    log "$1 backup done"
    write_metrics
  else
    echo 1 >"$kept/backup.failed"
    write_metrics
    return 1
  fi
}

# The measures in Prometheus' text format, from the repository itself, so they
# stay true across restarts. Left as they were when the repository cannot be
# read: the alerts then see the backups age.
write_metrics() {
  local info full diff out=$kept/metrics/backup.prom
  info=$(pgbackrest --stanza="$stanza" --output=json info 2>/dev/null) || return 0
  full=$(jq '[.[0].backup[] | select(.type == "full") | .timestamp.stop] | max // 0' <<<"$info")
  diff=$(jq '[.[0].backup[] | select(.type != "full") | .timestamp.stop] | max // 0' <<<"$info")
  {
    echo '# HELP pythagoras_backup_last_success_timestamp_seconds When the newest database backup of each type finished.'
    echo '# TYPE pythagoras_backup_last_success_timestamp_seconds gauge'
    echo "pythagoras_backup_last_success_timestamp_seconds{type=\"full\"} $full"
    echo "pythagoras_backup_last_success_timestamp_seconds{type=\"diff\"} $diff"
    echo '# HELP pythagoras_backup_last_run_failed Whether the last database backup failed.'
    echo '# TYPE pythagoras_backup_last_run_failed gauge'
    echo "pythagoras_backup_last_run_failed $(cat "$kept/backup.failed" 2>/dev/null || echo 0)"
    echo '# HELP pythagoras_documents_copy_last_success_timestamp_seconds When the documents were last copied off the host.'
    echo '# TYPE pythagoras_documents_copy_last_success_timestamp_seconds gauge'
    echo "pythagoras_documents_copy_last_success_timestamp_seconds $(cat "$kept/documents.last" 2>/dev/null || echo 0)"
    echo '# HELP pythagoras_restore_check_last_success_timestamp_seconds When a restore drill last succeeded (M8.7).'
    echo '# TYPE pythagoras_restore_check_last_success_timestamp_seconds gauge'
    echo "pythagoras_restore_check_last_success_timestamp_seconds $(cat "$kept/restore-check.last" 2>/dev/null || echo 0)"
    echo '# HELP pythagoras_restore_check_duration_seconds How long the last successful restore drill took, restore and checks.'
    echo '# TYPE pythagoras_restore_check_duration_seconds gauge'
    echo "pythagoras_restore_check_duration_seconds $(cat "$kept/restore-check.duration" 2>/dev/null || echo 0)"
  } >"$out.tmp"
  chmod 644 "$out.tmp"
  mv "$out.tmp" "$out"
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
  elif [[ -f "$kept/full-backup-due" ]]; then
    # After a restore (M8.7), a full backup of the new timeline at once.
    log "restored: a full backup now"
    until backup full; do sleep 60 & wait $!; done
  fi
  rm -f "$kept/full-backup-due"
  touch "$state/ready"
  write_metrics
  log "ready: the log is archived, and backups run at $hour:00 UTC"

  while kill -0 "$server" 2>/dev/null; do
    if (( $(date +%s) >= next_documents )); then
      documents || log "copying the documents failed"
      write_metrics
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

# ---- Restores (M8.7) ------------------------------------------------------
# Both restore into this container's /var/lib/postgresql (a scratch volume for
# the drill, the database's own volume for a real restore) and replay the
# write-ahead log in a PostgreSQL started here: no network, its own socket.

pgdata=/var/lib/postgresql/18/docker
here=/tmp/pythagoras-restore
live=/var/run/postgresql

fail() { log "FAILED: $*" >&2; exit 1; }
local_sql() { # sql [database]
  psql -X -q -At -v ON_ERROR_STOP=1 -h "$here" -U postgres -d "${2:-postgres}" -c "$1"
}
live_sql() { # sql [database]
  psql -X -q -At -v ON_ERROR_STOP=1 -h "$live" -U postgres -d "${2:-pythagoras}" -c "$1"
}
stamp() { date -u -d "@$1" +%Y%m%dT%H%M%SZ; }

# Starts the restored cluster and waits until it has replayed the log and
# taken over. archive_mode "off" for the drill, which must never write to the
# repository; "on" for a real restore, which pushes its new timeline there itself.
local_start() { # on|off
  mkdir -p "$here"
  printf 'local all postgres peer\nlocal all all reject\n' >"$here/pg_hba.conf"
  cat >"$here/postgresql.conf" <<CONF
include '/etc/postgresql/postgresql.conf'
hba_file = '$here/pg_hba.conf'
listen_addresses = ''
unix_socket_directories = '$here'
ssl = off
shared_buffers = 256MB
effective_cache_size = 1GB
huge_pages = off
log_connections = off
log_disconnections = off
log_checkpoints = off
log_statement = 'none'
archive_mode = $1
archive_command = 'pgbackrest --stanza=$stanza archive-push %p'
CONF
  pg_ctl -D "$pgdata" -l "$here/postgres.log" -o "-c config_file=$here/postgresql.conf" -W start >/dev/null
  local waited=0
  until [[ $(local_sql "SELECT pg_is_in_recovery()" 2>/dev/null) == f ]]; do
    if ! pg_ctl -D "$pgdata" status >/dev/null; then
      tail -20 "$here/postgres.log" >&2
      fail "PostgreSQL stopped while replaying the log"
    fi
    (( waited % 60 == 0 )) && log "replaying the write-ahead log (${waited}s)"
    sleep 5
    waited=$((waited + 5))
  done
}
local_stop() {
  if [[ -f "$pgdata/postmaster.pid" ]]; then pg_ctl -D "$pgdata" -m fast -w -t 300 stop >/dev/null; fi
}

# Waits until the segment holding everything up to now is in the repository;
# prints how long that took.
archived() { # psql function: local_sql|live_sql
  local segment since=$SECONDS last
  segment=$("$1" "SELECT pg_walfile_name(pg_switch_wal())" postgres)
  until last=$("$1" "SELECT coalesce(last_archived_wal, '') FROM pg_stat_archiver" postgres) && [[ ! "$last" < "$segment" ]]; do
    (( SECONDS - since > 600 )) && fail "segment $segment did not reach the repository within 10 minutes (last: $last)"
    sleep 2
  done
  echo $((SECONDS - since))
}

# Exact row count of every table of a database, "schema.table=count".
counts() { # psql function, database
  "$1" "$(cat /opt/pythagoras/db/ops/row_counts.sql)" "$2"
}

# The restore drill. Without a target and with the live database's socket (on
# the same host), it marks a named moment in the live database, counting every
# table of the platform's database at that moment, and waits until the moment
# is off the host; it then restores to exactly that moment and compares. With
# --time or --name it restores to that moment; without the socket (another
# host) to the latest one. Then: amcheck on every database, every table counted,
# the documents of the restored database present off the host (a sample read
# back against its checksum), and the time against the 4-hour target.
drill() { # [--time=T | --name=N]
  local started=$SECONDS begun type="" target="" marked="" lag="" cutoff report=$state/restore-check.report
  begun=$(date -u +%s)
  case ${1:-} in
    --time=*) type=time target=${1#--time=} ;;
    --name=*) type=name target=${1#--name=} ;;
    "") ;;
    *) echo "usage: pythagoras-backup drill [--time=T | --name=N]" >&2; exit 2 ;;
  esac
  # Only a scratch directory: empty, or one an earlier drill left.
  if [[ -n $(ls -A "$pgdata" 2>/dev/null) && ! -f /var/lib/postgresql/.pythagoras-drill ]]; then
    fail "$pgdata holds data that is not a drill's: refusing to replace it"
  fi
  touch /var/lib/postgresql/.pythagoras-drill
  trap local_stop EXIT
  : >"$report"

  if pg_isready -q -h "$live"; then
    if [[ -z $type ]]; then
      type=name target=drill-$(stamp "$begun") marked=$begun
      # The restore point and the counts in one snapshot: what the restore must reproduce.
      psql -X -q -At -v ON_ERROR_STOP=1 -h "$live" -U postgres -d pythagoras >"$state/live-counts" <<SQL
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT pg_create_restore_point('$target') \g /dev/null
$(cat /opt/pythagoras/db/ops/row_counts.sql)
COMMIT;
SQL
    fi
    lag=$(archived live_sql)
    log "the moment reached the off-site storage in ${lag}s (target: 5 minutes)"
    (( lag <= 300 )) || fail "the write-ahead log took ${lag}s to leave the host"
  fi
  [[ -n $type ]] || log "no live database here: restoring to the latest moment"
  log "restoring${target:+ to $type $target} into a scratch directory"
  rm -rf "$pgdata"
  install -d -m 700 "$pgdata"
  pgbackrest --stanza="$stanza" --pg1-path="$pgdata" --archive-mode=off \
    ${type:+--type=$type --target="$target" --target-action=promote} restore
  local_start off
  local restored=$((SECONDS - started))
  log "restored and running after ${restored}s"

  local db problems=0 tables=0 rows=0
  for db in $(local_sql "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY 1"); do
    if ! pg_amcheck -h "$here" -U postgres --install-missing --heapallindexed -d "$db" >"$here/amcheck.$db" 2>&1; then
      cat "$here/amcheck.$db" >&2
      fail "amcheck found damage in $db"
    fi
    counts local_sql "$db" >"$here/counts.$db"
    sed "s/^/$db: /" "$here/counts.$db" >>"$report"
    tables=$((tables + $(wc -l <"$here/counts.$db")))
    rows=$((rows + $(awk -F= '{s += $2} END {print s + 0}' "$here/counts.$db")))
    # The same tables as the live database.
    if pg_isready -q -h "$live" && ! diff <(cut -d= -f1 "$here/counts.$db") <(counts live_sql "$db" | cut -d= -f1) >/dev/null; then
      log "the tables of $db differ from the live database"
      problems=1
    fi
  done
  log "amcheck found nothing wrong; $tables tables, $rows rows"
  if [[ -n $marked ]]; then
    if diff "$state/live-counts" "$here/counts.pythagoras" >"$here/counts.diff"; then
      log "every table of the platform's database holds exactly what it held at the marked moment"
    else
      cat "$here/counts.diff" >&2
      log "the platform's tables differ from the marked moment"
      problems=1
    fi
  fi

  # The documents: present off the host as of the moment restored, unless
  # uploaded since the last copy.
  case $type in time) cutoff=$(date -u -d "$target" +%s) ;; *) cutoff=$begun ;; esac
  declare -A where=()
  local path key dir
  while read -r path; do where[$path]=current/$path; done < <(rclone lsf -R --files-only sealed:current 2>/dev/null)
  while read -r dir; do
    dir=${dir%/}
    [[ "$dir" > "$(stamp "$cutoff")" ]] || continue
    while read -r path; do where[$path]=removed/$dir/$path; done < <(rclone lsf -R --files-only "sealed:removed/$dir")
  done < <(rclone lsf --dirs-only sealed:removed 2>/dev/null)
  local copied present=0 recent=0 missing=0 verified=0 hash uploaded sample=${DRILL_DOCUMENT_CHECKS:-20}
  copied=$(cat "$kept/documents.last" 2>/dev/null || echo 0)
  while IFS="|" read -r key hash uploaded; do
    [[ -n $key ]] || continue
    if [[ -n ${where[$key]:-} ]]; then
      present=$((present + 1))
      if (( verified < sample )) && [[ $(rclone cat "sealed:${where[$key]}" | sha256sum | cut -d' ' -f1) == "$hash" ]]; then
        verified=$((verified + 1))
      elif (( verified < sample )); then
        log "document $key does not match its checksum"
        problems=1
      fi
    elif (( uploaded >= copied - 60 )); then
      recent=$((recent + 1))
    else
      log "document $key is not in the off-site copy"
      missing=$((missing + 1))
    fi
  done < <(local_sql "SELECT object_key, encode(sha256, 'hex'), extract(epoch FROM uploaded_at)::bigint FROM documents.version ORDER BY random()" pythagoras)
  log "documents: $present present off the host, $verified read back against their checksums, $recent newer than the last copy, $missing missing"
  (( missing == 0 )) || problems=1

  local_stop
  rm -rf "$pgdata"
  local took=$((SECONDS - started))
  {
    echo "drill: $(date -u -d "@$begun" '+%F %T') UTC; restored to ${type:-latest}${target:+ $target}"
    echo "drill: ${lag:-?}s for the moment to leave the host; running after ${restored}s; ${took}s in all (target: 4 hours)"
    echo "drill: $tables tables, $rows rows; documents $present present, $verified verified, $recent recent, $missing missing"
  } >>"$report"
  cp "$report" "$kept/restore-check.report"
  (( took <= 14400 )) || fail "the drill took ${took}s, more than 4 hours"
  (( problems == 0 )) || fail "see above"
  echo "$took" >"$kept/restore-check.duration"
  date -u +%s >"$kept/restore-check.last"
  write_metrics
  log "drill passed in ${took}s (target: 4 hours)"
}

# A lost server, step 1: the documents back into the (new, empty) bucket, as
# they were at T: the current copy, and what was moved aside after T.
restore_documents() { # [T]
  [[ -n ${RCLONE_CONFIG_DOCUMENTS_TYPE:-} ]] || fail "no documents bucket configured"
  rclone copy sealed:current "documents:$documents_bucket" --stats 0 || fail "copying the documents back failed"
  if [[ -n ${1:-} ]]; then
    local after dir
    after=$(stamp "$(date -u -d "$1" +%s)")
    while read -r dir; do
      dir=${dir%/}
      [[ "$dir" > "$after" ]] || continue
      rclone copy "sealed:removed/$dir" "documents:$documents_bucket" --stats 0 || fail "copying $dir back failed"
    done < <(rclone lsf --dirs-only sealed:removed 2>/dev/null)
  fi
  log "documents restored: $(rclone lsf -R --files-only "documents:$documents_bucket" | wc -l) objects"
}

# Step 2: the database, into the database's own (empty) volume, to the latest
# moment or T. It replays the log here, then archives its new timeline itself,
# so the backups continue from the restored database; the backup service then
# takes a full backup first.
restore_database() { # [T]
  local started=$SECONDS
  [[ -f "$pgdata/postmaster.pid" ]] && fail "PostgreSQL seems to be running on this data directory: stop it first"
  local delta=()
  if [[ -n $(ls -A "$pgdata" 2>/dev/null) ]]; then
    [[ ${RESTORE_OVERWRITE:-} == yes ]] || fail "$pgdata is not empty: set RESTORE_OVERWRITE=yes to replace it"
    delta=(--delta)
  fi
  install -d -m 700 "$pgdata"
  trap local_stop EXIT
  log "restoring the database${1:+ to $1}"
  pgbackrest --stanza="$stanza" --pg1-path="$pgdata" "${delta[@]}" \
    ${1:+--type=time --target="$1" --target-action=promote} restore
  local_start on
  log "the restored database's new timeline reached the off-site storage in $(archived local_sql)s"
  local_stop
  touch "$kept/full-backup-due"
  log "database restored in $((SECONDS - started))s; start the stack now"
}

case ${1:-run} in
  run) run ;;
  full | diff) prepare; backup "$1" ;;
  documents) prepare; documents; write_metrics; log "documents copied" ;;
  pgbackrest | rclone) prepare; exec "$@" ;;
  health) [[ -f "$state/ready" ]] && PGBACKREST_CONFIG=/etc/pgbackrest/repository.conf pgbackrest server-ping localhost >/dev/null ;;
  drill) prepare; drill "${@:2}" ;;
  restore)
    prepare
    case ${2:-} in
      documents) restore_documents "${3:-}" ;;
      database) restore_database "${3:-}" ;;
      *) echo "usage: pythagoras-backup restore documents|database [time]" >&2; exit 2 ;;
    esac
    ;;
  *) echo "usage: pythagoras-backup [run|full|diff|documents|pgbackrest …|rclone …|health|drill|restore]" >&2; exit 2 ;;
esac
