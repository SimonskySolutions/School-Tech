#!/bin/bash
# Reads Docker secrets into the environment variables Keycloak and the realm
# import placeholders expect, then starts Keycloak. Secrets never appear in
# compose.yaml, the image or the realm file.
set -euo pipefail

read_secret() { tr -d '\r\n' < "/run/secrets/$1"; }

export KC_DB_PASSWORD="$(read_secret pg_keycloak_password)"
export KC_BOOTSTRAP_ADMIN_PASSWORD="$(read_secret keycloak_admin_password)"
export KC_WEB_CLIENT_SECRET="$(read_secret keycloak_web_client_secret)"
export KC_PROVISIONING_CLIENT_SECRET="$(read_secret keycloak_provisioning_client_secret)"
export KC_CMS_CLIENT_SECRET="$(read_secret keycloak_cms_client_secret)"
if [[ -f /run/secrets/keycloak_dev_user_password ]]; then
  export KC_DEV_USER_PASSWORD="$(read_secret keycloak_dev_user_password)"
fi
# Production (M8.3): the realm's e-mail settings. MAIL_FROM is "Name <address>" or an address.
if [[ -f /run/secrets/smtp_password ]]; then
  export KC_SMTP_PASSWORD="$(read_secret smtp_password)"
fi
if [[ -n "${MAIL_FROM:-}" ]]; then
  named='^(.*[^[:space:]])[[:space:]]*<([^<>]+)>$'
  if [[ "$MAIL_FROM" =~ $named ]]; then
    export KC_SMTP_FROM_NAME="${BASH_REMATCH[1]}" KC_SMTP_FROM="${BASH_REMATCH[2]}"
  else
    export KC_SMTP_FROM_NAME=Pythagoras KC_SMTP_FROM="$MAIL_FROM"
  fi
fi

exec /opt/keycloak/bin/kc.sh "$@"
