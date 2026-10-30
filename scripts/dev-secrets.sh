#!/usr/bin/env bash
# Generates random local development secrets in ./secrets (git-ignored).
# Existing files are kept, so re-running never rotates a password by accident.
set -euo pipefail
cd "$(dirname "$0")/.."

mkdir -p secrets
names=(
  pg_superuser_password pg_migrator_password pg_api_password pg_worker_password
  pg_reporting_password pg_backup_password
  redis_queue_password redis_health_password redis_admin_password
  pg_keycloak_password keycloak_admin_password keycloak_web_client_secret keycloak_dev_user_password
  keycloak_provisioning_client_secret
  web_session_secret dev_payments_secret
)

for name in "${names[@]}"; do
  file="secrets/$name"
  if [[ -s "$file" ]]; then
    echo "kept      $file"
  else
    # 32 random bytes as hex: URL-safe, so it can go into connection strings unescaped.
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$file"
    chmod 600 "$file" 2>/dev/null || true
    echo "generated $file"
  fi
done
