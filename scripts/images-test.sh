#!/usr/bin/env bash
# Checks the production images (ADR 0033), as CI does after building them:
#   scripts/images-test.sh [tag]        (default tag: local)
# - the application images run as an unprivileged user;
# - no image contains a file named like one of the platform's secrets;
# - the migration job carries exactly the repository's migrations;
# - Keycloak is built for production with the Pythagoras theme;
# - the PostgreSQL image carries the pinned pgBackRest and rclone (M8.5);
# - the monitoring image's configuration is valid and every alert fires in
#   its unit test (M8.6).
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
tag=${1:-local}
failed=0
ok() { echo "ok - $1"; }
fail() { echo "not ok - $1"; failed=1; }

declare -A expected_user=([api]=node [web]=node [cms]=node [keycloak]=1000 [migrate]=65534:65534 [garage]=1000:1000 [pgbouncer]=postgres [monitoring]=nobody)
for image in api web cms keycloak migrate garage pgbouncer monitoring; do
  user=$(docker image inspect -f '{{.Config.User}}' "pythagoras-$image:$tag")
  if [[ "$user" == "${expected_user[$image]}" ]]; then ok "$image runs as $user"; else fail "$image runs as '$user'"; fi
done

# The names come from the scripts that create them, so a new secret is covered too.
mapfile -t secret_names < <(
  sed -n '/^names=(/,/^)/p' scripts/dev-secrets.sh | grep -oE '[a-z][a-z0-9_]+' | grep -v '^names$'
  sed -n '/^generated=(/,/^)/p' scripts/prod-secrets.sh | grep -oE '[a-z][a-z0-9_]+' | grep -v '^generated$'
  sed -n '/^declare -A issued=(/,/^)/p' scripts/prod-secrets.sh | grep -oE '\[[a-z0-9_]+\]' | tr -d '[]'
)
pattern="(^|/)($(IFS='|'; echo "${secret_names[*]}"))\$"
for image in api web cms keycloak migrate postgres redis gateway garage pgbouncer monitoring; do
  container=$(docker create "pythagoras-$image:$tag")
  found=$(docker export "$container" | tar -t | grep -E "$pattern" || true)
  docker rm "$container" >/dev/null
  if [[ -z "$found" ]]; then ok "$image holds no secret file"; else fail "$image holds $found"; fi
done

inside=$(docker run --rm --entrypoint sh "pythagoras-migrate:$tag" -c 'ls /db/migrations' | sort)
here=$(ls db/migrations | sort)
if [[ "$inside" == "$here" ]]; then ok "migrate carries the $(wc -l <<<"$here") migrations of the repository"; else fail "migrate carries different migrations"; fi

if docker run --rm --entrypoint ls "pythagoras-keycloak:$tag" /opt/keycloak/themes/pythagoras/login/theme.properties >/dev/null 2>&1; then
  ok "keycloak has the Pythagoras theme"
else
  fail "keycloak lacks the Pythagoras theme"
fi
# Options fixed by `kc.sh build` show as "Persisted"; the base image has none.
built=$(docker run --rm --entrypoint /opt/keycloak/bin/kc.sh "pythagoras-keycloak:$tag" show-config 2>/dev/null || true)
if grep -qE 'kc\.db += +postgres \(Persisted\)' <<<"$built"; then
  ok "keycloak is built for PostgreSQL (start --optimized)"
else
  fail "keycloak was not built for PostgreSQL"
fi

tools=$(docker run --rm --entrypoint sh "pythagoras-postgres:$tag" -c 'pgbackrest version; rclone version | head -1' | tr -d '\r' | tr '\n' ' ')
if [[ "$tools" == "pgBackRest 2.60.0 rclone v1.75.2 " ]]; then
  ok "postgres carries pgBackRest 2.60.0 and rclone v1.75.2"
else
  fail "postgres carries '$tools'"
fi

if docker run --rm "pythagoras-monitoring:$tag" test >"${TMPDIR:-/tmp}/monitoring-test.log" 2>&1; then
  ok "monitoring's configuration is valid and every alert fires in its test"
else
  fail "monitoring's configuration or alert tests failed"
  cat "${TMPDIR:-/tmp}/monitoring-test.log"
fi

if [[ $failed -ne 0 ]]; then echo "images: FAILED"; exit 1; fi
echo "images: all checks passed"
