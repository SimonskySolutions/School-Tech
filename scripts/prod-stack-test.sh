#!/usr/bin/env bash
# Starts the production stack (compose.production.yaml) from nothing with
# throwaway secrets, checks it as CI does after building the images, and
# removes it again (ADR 0033):
#   scripts/prod-stack-test.sh [tag]        (default tag: local; KEEP=1 keeps it running)
# - every service healthy, the migration job and storage set-up finished;
# - only the gateway published; the data network internal and out of the
#   gateway's and the web server's reach;
# - HTTPS with HSTS on every host, plain HTTP redirected, the identity
#   console and the internal routes not public;
# - every migration applied, and a failing one stops a release without
#   touching the database or the running version;
# - application containers read-only, without capabilities, unprivileged.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
tag=${1:-local}
project=pythagoras-prod-check
http_port=54080
https_port=54443
failed=0
ok() { echo "ok - $1"; }
fail() { echo "not ok - $1"; failed=1; }

work=$(mktemp -d)
host_path() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else echo "$1"; fi; }
cat > "$work/env" <<EOF
STACK_NAME=$project
IMAGE_TAG=$tag
SECRETS_DIR=$(host_path "$work/secrets")
PORTAL_HOST=portal.pythagoras.test
AUTH_HOST=auth.pythagoras.test
API_HOST=api.pythagoras.test
CMS_HOST=cms.pythagoras.test
ACME_EMAIL=platform@example.bg
LOCAL_CERTS=local_certs
HTTP_PORT=$http_port
HTTPS_PORT=$https_port
PUBLIC_PORT=:$https_port
SMTP_HOST=smtp.example.bg
SMTP_USER=no-reply@example.bg
MAIL_FROM=Pythagoras <no-reply@example.bg>
STORAGE_ACCESS_KEY_ID=GK$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')
STORAGE_CAPACITY_GB=1
EOF
bash scripts/prod-secrets.sh "$work/secrets" >/dev/null

compose() { docker compose -p "$project" -f compose.production.yaml --env-file "$(host_path "$work/env")" "$@"; }
cleanup() {
  if [[ "${KEEP:-}" == 1 ]]; then
    echo "kept running: docker compose -p $project -f compose.production.yaml --env-file $(host_path "$work/env") ..."
  else
    compose down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$work"
  fi
}
trap cleanup EXIT

if compose up -d --wait --wait-timeout 600 >"$work/up.log" 2>&1; then
  ok "the stack starts from nothing"
else
  fail "the stack did not start"
  cat "$work/up.log"
  compose ps -a
  compose logs --no-color --tail 40
  exit 1
fi

for job in migrate storage-init; do
  state=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$(compose ps -a -q "$job")")
  if [[ "$state" == "exited 0" ]]; then ok "$job finished"; else fail "$job is '$state'"; fi
done
unhealthy=$(compose ps --format '{{.Service}} {{.Health}}' | grep -v ' healthy$' || true)
if [[ -z "$unhealthy" ]]; then ok "every service is healthy"; else fail "not healthy: $unhealthy"; fi

published=$(compose ps --format '{{.Service}} {{.Ports}}' | grep -- '->' | cut -d' ' -f1 | sort -u | tr '\n' ' ')
if [[ "$published" == "gateway " ]]; then ok "only the gateway is published"; else fail "published: $published"; fi

if [[ "$(docker network inspect -f '{{.Internal}}' "${project}_data")" == true ]]; then
  ok "the data network has no way out"
else
  fail "the data network is not internal"
fi
networks() { docker inspect -f '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}} {{end}}' "$(compose ps -q "$1")" | sed "s/${project}_//g"; }
for service in postgres redis garage; do
  if [[ "$(networks "$service")" == "data " ]]; then ok "$service is on the data network only"; else fail "$service is on $(networks "$service")"; fi
done
if compose exec -T gateway wget -q -T 3 -O /dev/null http://postgres:5432 2>/dev/null; then
  fail "the gateway reaches PostgreSQL"
else
  ok "the gateway cannot reach the data network"
fi
if compose exec -T web node -e "require('dns').lookup('postgres', (e) => process.exit(e ? 1 : 0))"; then
  fail "the web server reaches PostgreSQL"
else
  ok "the web server cannot reach the data network"
fi

# HTTPS through the published port, trusting only the gateway's local authority
# (Windows' TLS library cannot check revocation for it; other libraries ignore the flag).
compose exec -T gateway cat /data/caddy/pki/authorities/local/root.crt >"$work/root.crt"
ca=$(host_path "$work/root.crt")
request() { # host path [curl options]
  local host=$1 path=$2; shift 2
  curl -s -o /dev/null --max-time 20 --ssl-no-revoke --cacert "$ca" \
    --resolve "$host:$https_port:127.0.0.1" --resolve "$host:$http_port:127.0.0.1" "$@" \
    -w '%{http_code}' "https://$host:$https_port$path"
}
expect() { # description expected host path
  local got
  got=$(request "$3" "$4") || true
  if [[ "$got" == "$2" ]]; then ok "$1"; else fail "$1 (answered $got)"; fi
}
expect "the portal answers over HTTPS" 200 portal.pythagoras.test /
expect "the API is ready behind the gateway" 200 api.pythagoras.test /health/ready
expect "the website editor answers" 200 cms.pythagoras.test /admin/login
expect "the identity provider answers" 200 auth.pythagoras.test /realms/master
expect "the identity console is not public" 404 auth.pythagoras.test /admin/
expect "the portal hides the internal routes" 404 portal.pythagoras.test /internal/tls/allowed

hsts=$(curl -s -D - -o /dev/null --max-time 20 --ssl-no-revoke --cacert "$ca" \
  --resolve "portal.pythagoras.test:$https_port:127.0.0.1" "https://portal.pythagoras.test:$https_port/" | tr -d '\r' | grep -i '^strict-transport-security:' || true)
if [[ "$hsts" == *max-age=31536000* ]]; then ok "HSTS is sent"; else fail "no HSTS header"; fi
redirect=$(curl -s -o /dev/null --max-time 20 --resolve "portal.pythagoras.test:$http_port:127.0.0.1" \
  -w '%{http_code} %{redirect_url}' "http://portal.pythagoras.test:$http_port/")
if [[ "$redirect" == 308\ https://portal.pythagoras.test/* ]]; then ok "plain HTTP is redirected to HTTPS"; else fail "plain HTTP answered '$redirect'"; fi

sql() { compose exec -T postgres gosu postgres psql -XtAq -d pythagoras -c "$1"; }
applied=$(sql "SELECT count(*) FROM meta.schema_migrations")
here=$(ls db/migrations | wc -l | tr -d ' ')
if [[ "$applied" == "$here" ]]; then ok "all $here migrations are applied"; else fail "$applied of $here migrations applied"; fi

# A release runs the migration job before replacing anything (docs/operations.md).
cat >"$work/failing.sql" <<'EOF'
-- migrate:up
CREATE TABLE public.release_check (id int);
SELECT 1 / 0;
-- migrate:down
DROP TABLE public.release_check;
EOF
chmod 644 "$work/failing.sql"
if compose run --rm --no-deps -v "$(host_path "$work/failing.sql"):/db/migrations/99990101000000_release_check.sql:ro" migrate >"$work/failing.log" 2>&1; then
  fail "a failing migration was reported as applied"
elif grep -q 'division by zero' "$work/failing.log"; then
  ok "a failing migration stops the release"
else
  fail "the migration job failed for another reason"
  cat "$work/failing.log"
fi
if [[ "$(sql "SELECT count(*) FROM meta.schema_migrations")" == "$here" && -z "$(sql "SELECT to_regclass('public.release_check')")" ]]; then
  ok "the failed migration left the database as it was"
else
  fail "the failed migration changed the database"
fi
expect "the running version keeps serving" 200 api.pythagoras.test /health/ready

for service in api worker web cms gateway storage-init migrate; do
  id=$(compose ps -a -q "$service")
  settings=$(docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.Privileged}} {{.Config.User}}' "$id")
  read -r readonly capdrop privileged user <<<"$settings"
  if [[ "$readonly" == true && "$capdrop" == "[ALL]" && "$privileged" == false ]]; then
    ok "$service is read-only without capabilities${user:+ as $user}"
  else
    fail "$service runs with '$settings'"
  fi
done

if [[ $failed -ne 0 ]]; then
  echo "production stack: FAILED"
  compose logs --no-color --tail 40
  exit 1
fi
echo "production stack: all checks passed"
