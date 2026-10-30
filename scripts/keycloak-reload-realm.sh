#!/usr/bin/env bash
# Development only: deletes the "pythagoras" realm and restarts Keycloak, which
# then imports it again from infra/keycloak/realm/pythagoras-realm.json. Use it
# after changing the realm file. Synthetic users keep their fixed ids, so the
# links to person records stay valid; accounts created since are removed.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose exec -T keycloak bash -c '
  set -e
  kcadm=/opt/keycloak/bin/kcadm.sh
  $kcadm config credentials --server http://127.0.0.1:8080 --realm master --user admin \
    --password "$(tr -d "\r\n" < /run/secrets/keycloak_admin_password)" >/dev/null
  $kcadm delete realms/pythagoras
'
docker compose up -d --force-recreate --wait keycloak >/dev/null 2>&1
echo "keycloak: realm pythagoras reloaded from the realm file"
