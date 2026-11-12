#!/usr/bin/env bash
# Creates the production secret files (ADR 0033) in a directory only its owner
# may enter, one file per secret, as compose.production.yaml expects:
#   sudo scripts/prod-secrets.sh /etc/pythagoras/secrets
# Existing files are kept, so re-running never rotates a password by accident.
#
# Secrets the platform makes are random. Secrets a provider issues are taken
# from the environment when set (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
# SMTP_PASSWORD, BACKUP_S3_SECRET_KEY); otherwise a placeholder is written and listed at the end, to
# be replaced before the service it belongs to is used. The files are readable
# by every user because the containers run as unprivileged users; the
# directory is what keeps them private.
#
# It also makes the private certificate authority for the connections inside
# the host (M8.4): PostgreSQL, PgBouncer, Redis and the backup service each get
# a certificate for their service name (TLS_EXTRA_SERVICES adds more, for the
# local stand-in of the off-site storage). The authority's key (tls_ca_key)
# stays here and is never mounted into a container. To renew a certificate,
# delete its two files and run the script again; delete tls_ca_* too to
# replace the authority.
#
# The backup passphrases (backup_cipher_pass, backup_documents_pass,
# backup_documents_salt) must also be kept somewhere other than this host:
# without them the off-site backups cannot be read (docs/operations.md).
set -euo pipefail
# Git Bash on Windows would rewrite the certificate subjects as paths, but
# must still translate file paths for openssl.
export MSYS2_ARG_CONV_EXCL='/CN='
unset MSYS_NO_PATHCONV
dir=${1:?usage: prod-secrets.sh <directory>}

umask 077
mkdir -p "$dir"
chmod 700 "$dir"

# The development-only secrets (keycloak_dev_user_password, dev_payments_secret)
# are not made: production refuses the features that use them.
generated=(
  pg_superuser_password pg_migrator_password pg_api_password pg_worker_password
  pg_reporting_password pg_backup_password pg_cms_password pg_keycloak_password pg_monitor_password
  redis_queue_password redis_health_password redis_admin_password redis_monitor_password
  keycloak_admin_password keycloak_web_client_secret
  keycloak_provisioning_client_secret keycloak_cms_client_secret
  web_session_secret cms_payload_secret cms_platform_api_key
  garage_rpc_secret garage_admin_token garage_metrics_token storage_secret_access_key
  storage_backup_secret_access_key
  backup_cipher_pass backup_documents_pass backup_documents_salt
)
declare -A issued=(
  [stripe_secret_key]=STRIPE_SECRET_KEY
  [stripe_webhook_secret]=STRIPE_WEBHOOK_SECRET
  [smtp_password]=SMTP_PASSWORD
  [backup_s3_secret_key]=BACKUP_S3_SECRET_KEY
)

write() {
  printf '%s' "$2" > "$dir/$1"
  chmod 444 "$dir/$1"
}

for name in "${generated[@]}"; do
  if [[ -s "$dir/$name" ]]; then
    echo "kept      $name"
  else
    # 32 random bytes as hex: safe in connection strings without escaping.
    write "$name" "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    echo "generated $name"
  fi
done

placeholders=()
for name in "${!issued[@]}"; do
  variable=${issued[$name]}
  if [[ -n "${!variable:-}" ]]; then
    write "$name" "${!variable}"
    echo "stored    $name"
  elif [[ -s "$dir/$name" ]]; then
    echo "kept      $name"
    if grep -q '^placeholder-' "$dir/$name"; then placeholders+=("$name"); fi
  else
    write "$name" "placeholder-$name"
    echo "placeholder $name"
    placeholders+=("$name")
  fi
done

if [[ ${#placeholders[@]} -gt 0 ]]; then
  echo
  echo "Still placeholders (re-run with the variable set, or replace the file):"
  printf '  %s\n' "${placeholders[@]}"
fi
# The certificate authority and a certificate per service (ECDSA P-256).
if [[ ! -s "$dir/tls_ca_crt" || ! -s "$dir/tls_ca_key" ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$dir/tls_ca_key" 2>/dev/null
  cat >"$dir/ca.cnf" <<'CONF'
[req]
distinguished_name = dn
[dn]
[v3_ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
CONF
  openssl req -new -x509 -key "$dir/tls_ca_key" -subj "/CN=Pythagoras internal CA" -days 3650 -sha256 \
    -config "$dir/ca.cnf" -extensions v3_ca -out "$dir/tls_ca_crt"
  rm -f "$dir/ca.cnf"
  chmod 400 "$dir/tls_ca_key"
  chmod 444 "$dir/tls_ca_crt"
  echo "generated tls_ca"
else
  echo "kept      tls_ca"
fi
# shellcheck disable=SC2086 # a list of names
for service in postgres pgbouncer redis backup ${TLS_EXTRA_SERVICES:-}; do
  if [[ -s "$dir/tls_${service}_crt" && -s "$dir/tls_${service}_key" ]]; then
    echo "kept      tls_$service"
    continue
  fi
  openssl ecparam -name prime256v1 -genkey -noout -out "$dir/tls_${service}_key" 2>/dev/null
  openssl req -new -key "$dir/tls_${service}_key" -subj "/CN=$service" -out "$dir/$service.csr"
  # The database also presents its certificate to the backup service (M8.5).
  usage=serverAuth
  if [[ $service == postgres ]]; then usage="serverAuth, clientAuth"; fi
  cat >"$dir/$service.ext" <<CONF
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = $usage
subjectAltName = DNS:$service, DNS:localhost, IP:127.0.0.1
CONF
  openssl x509 -req -in "$dir/$service.csr" -CA "$dir/tls_ca_crt" -CAkey "$dir/tls_ca_key" -CAcreateserial \
    -days 825 -sha256 -extfile "$dir/$service.ext" -out "$dir/tls_${service}_crt" 2>/dev/null
  rm -f "$dir/$service.csr" "$dir/$service.ext" "$dir/tls_ca_srl"
  chmod 444 "$dir/tls_${service}_crt" "$dir/tls_${service}_key"
  echo "generated tls_$service"
done

echo
echo "New key ids for the object store, if .env has none yet:"
echo "  STORAGE_ACCESS_KEY_ID=GK$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
echo "  BACKUP_STORAGE_ACCESS_KEY_ID=GK$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
