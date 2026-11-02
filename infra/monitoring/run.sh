#!/bin/sh
# Starts one part of the monitoring (M8.6, ADR 0036) from the monitoring image:
#   run.sh prometheus|alertmanager|blackbox|node-exporter|postgres-exporter|pgbouncer-exporter|redis-exporter
#   run.sh test        checks the configuration and runs the alert rules' unit tests
# Settings come from the environment and are written into the configuration
# files on memory-only storage; passwords stay in their secret files or this
# process's environment.
set -eu
dir=/etc/pythagoras-monitoring

# Copies a template, replacing __NAME__ with the variable NAME for each name given.
fill() { # template output NAME...
  template=$1 output=$2
  shift 2
  awk -v names="$*" '
    BEGIN { n = split(names, k, " ") }
    {
      for (i = 1; i <= n; i++) {
        t = "__" k[i] "__"; v = ENVIRON[k[i]]
        while ((p = index($0, t)) > 0) $0 = substr($0, 1, p - 1) v substr($0, p + length(t))
      }
      print
    }' "$template" >"$output"
}

service=${1:?usage: run.sh <service>}
shift
case $service in
  prometheus)
    export INSTALLATION="${PORTAL_HOST:?}"
    fill "$dir/prometheus.yml" /tmp/prometheus.yml INSTALLATION
    exec /bin/prometheus --config.file=/tmp/prometheus.yml --storage.tsdb.path=/prometheus \
      --storage.tsdb.retention.time="${MONITOR_RETENTION:-30d}" --web.listen-address=:9090 "$@"
    ;;
  alertmanager)
    : "${SMTP_HOST:?}" "${SMTP_PORT:?}" "${SMTP_USER:?}" "${MAIL_FROM:?}" "${ALERT_EMAIL_TO:?}"
    fill "$dir/alertmanager.yml" /tmp/alertmanager.yml SMTP_HOST SMTP_PORT SMTP_USER MAIL_FROM ALERT_EMAIL_TO
    # A private authority for the mail service (the local stand-in); public ones otherwise.
    if [ -n "${ALERT_SMTP_CA_FILE:-}" ]; then
      printf '        tls_config:\n          ca_file: %s\n' "$ALERT_SMTP_CA_FILE" >>/tmp/alertmanager.yml
    fi
    exec /bin/alertmanager --config.file=/tmp/alertmanager.yml --storage.path=/alertmanager \
      --cluster.listen-address= --web.listen-address=:9093 "$@"
    ;;
  blackbox)
    # Only the local proof signs the gateway's certificates with its own authority.
    if [ -n "${LOCAL_CERTS:-}" ]; then export TLS_INSECURE=true; else export TLS_INSECURE=false; fi
    export PORTAL_HOST="${PORTAL_HOST:?}"
    fill "$dir/blackbox.yml" /tmp/blackbox.yml PORTAL_HOST TLS_INSECURE
    exec /bin/blackbox_exporter --config.file=/tmp/blackbox.yml "$@"
    ;;
  node-exporter)
    exec /bin/node_exporter --path.rootfs=/host --collector.textfile.directory=/backup-state/metrics \
      --collector.filesystem.mount-points-exclude='^/(dev|proc|sys|run|var/lib/docker/.+)($|/)' "$@"
    ;;
  postgres-exporter)
    exec /bin/postgres_exporter --collector.stat_archiver --collector.long_running_transactions "$@"
    ;;
  pgbouncer-exporter)
    PGPASSWORD=$(cat /run/secrets/pg_monitor_password)
    export PGPASSWORD
    exec /bin/pgbouncer_exporter \
      --pgBouncer.connectionString="postgres://pyth_monitor@pgbouncer:6432/pgbouncer?sslmode=verify-full&sslrootcert=/run/secrets/tls_ca_crt" "$@"
    ;;
  redis-exporter)
    REDIS_PASSWORD=$(cat /run/secrets/redis_monitor_password)
    export REDIS_PASSWORD
    exec /bin/redis_exporter -redis.addr rediss://redis:6379 -redis.user pyth_monitor \
      -tls-ca-cert-file /run/secrets/tls_ca_crt "$@"
    ;;
  test)
    export INSTALLATION=test SMTP_HOST=smtp.example.bg SMTP_PORT=587 SMTP_USER=alerts MAIL_FROM=alerts@example.bg \
      ALERT_EMAIL_TO=platform@example.bg PORTAL_HOST=portal.example.bg TLS_INSECURE=false
    fill "$dir/prometheus.yml" /tmp/prometheus.yml INSTALLATION
    fill "$dir/alertmanager.yml" /tmp/alertmanager.yml SMTP_HOST SMTP_PORT SMTP_USER MAIL_FROM ALERT_EMAIL_TO
    fill "$dir/blackbox.yml" /tmp/blackbox.yml PORTAL_HOST TLS_INSECURE
    /bin/promtool check config --syntax-only /tmp/prometheus.yml
    /bin/amtool check-config /tmp/alertmanager.yml
    /bin/blackbox_exporter --config.check --config.file=/tmp/blackbox.yml
    # Every alert has a test that makes it fire.
    missing=$(grep -ho 'alert: [A-Za-z]*' "$dir"/rules/*.yml | cut -d' ' -f2 | sort -u | while read -r alert; do
      grep -q "alertname: $alert\$" "$dir"/tests/*.yml || echo "$alert"
    done)
    if [ -n "$missing" ]; then echo "alerts without a test:" $missing >&2; exit 1; fi
    cd "$dir/tests"
    exec /bin/promtool test rules ./*.yml
    ;;
  *)
    echo "unknown service: $service" >&2
    exit 2
    ;;
esac
