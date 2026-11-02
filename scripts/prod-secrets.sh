#!/usr/bin/env bash
# Creates the production secret files (ADR 0033) in a directory only its owner
# may enter, one file per secret, as compose.production.yaml expects:
#   sudo scripts/prod-secrets.sh /etc/pythagoras/secrets
# Existing files are kept, so re-running never rotates a password by accident.
#
# Secrets the platform makes are random. Secrets a provider issues are taken
# from the environment when set (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
# SMTP_PASSWORD); otherwise a placeholder is written and listed at the end, to
# be replaced before the service it belongs to is used. The files are readable
# by every user because the containers run as unprivileged users; the
# directory is what keeps them private.
set -euo pipefail
dir=${1:?usage: prod-secrets.sh <directory>}

umask 077
mkdir -p "$dir"
chmod 700 "$dir"

# The development-only secrets (keycloak_dev_user_password, dev_payments_secret)
# are not made: production refuses the features that use them.
generated=(
  pg_superuser_password pg_migrator_password pg_api_password pg_worker_password
  pg_reporting_password pg_backup_password pg_cms_password pg_keycloak_password
  redis_queue_password redis_health_password redis_admin_password
  keycloak_admin_password keycloak_web_client_secret
  keycloak_provisioning_client_secret keycloak_cms_client_secret
  web_session_secret cms_payload_secret cms_platform_api_key
  garage_rpc_secret garage_admin_token storage_secret_access_key
)
declare -A issued=(
  [stripe_secret_key]=STRIPE_SECRET_KEY
  [stripe_webhook_secret]=STRIPE_WEBHOOK_SECRET
  [smtp_password]=SMTP_PASSWORD
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
echo
echo "A new key id for the object store, if .env has none yet:"
echo "  STORAGE_ACCESS_KEY_ID=GK$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
