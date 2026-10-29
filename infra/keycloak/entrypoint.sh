#!/bin/bash
# Reads Docker secrets into the environment variables Keycloak and the realm
# import placeholders expect, then starts Keycloak. Secrets never appear in
# compose.yaml, the image or the realm file.
set -euo pipefail

read_secret() { tr -d '\r\n' < "/run/secrets/$1"; }

export KC_DB_PASSWORD="$(read_secret pg_keycloak_password)"
export KC_BOOTSTRAP_ADMIN_PASSWORD="$(read_secret keycloak_admin_password)"
export KC_WEB_CLIENT_SECRET="$(read_secret keycloak_web_client_secret)"
if [[ -f /run/secrets/keycloak_dev_user_password ]]; then
  export KC_DEV_USER_PASSWORD="$(read_secret keycloak_dev_user_password)"
fi

exec /opt/keycloak/bin/kc.sh "$@"
