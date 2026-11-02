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
# - TLS 1.3 to PostgreSQL, PgBouncer and Redis with verified certificates,
#   nothing unencrypted accepted, the API and worker only through PgBouncer;
# - the production realm: no users or development client, the step-up
#   sign-in, e-mail, events kept 30 days; a parent signs in with a password,
#   staff only after setting up and then entering a one-time code;
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
for service in postgres pgbouncer redis garage; do
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

# The production realm (M8.3), read through Keycloak's own admin tool inside
# its container: the way an administrator reaches it in production too.
PY=$(command -v python3 || command -v python)
kc() {
  compose exec -T keycloak bash -c '
    k=/opt/keycloak/bin/kcadm.sh
    [[ -f /tmp/kcadm.config ]] || $k config credentials --config /tmp/kcadm.config --server http://localhost:8080 \
      --realm master --user admin --password "$(cat /run/secrets/keycloak_admin_password)" >/dev/null 2>&1
    $k "$@" --config /tmp/kcadm.config' kc "$@" | tr -d '\r'
}
field() { "$PY" -c "import json, sys; d = json.load(sys.stdin); print($1)"; }
same() { # description expected actual
  if [[ "$3" == "$2" ]]; then ok "$1"; else fail "$1 (found $3)"; fi
}
realm=$(kc get realms/pythagoras)
same "sign-in is the step-up flow" "pythagoras browser" "$(field "d['browserFlow']" <<<"$realm")"
same "the second factor is the mfa level" '{"password":1,"mfa":2}' "$(field "d['attributes'].get('acr.loa.map')" <<<"$realm")"
same "sign-in events are kept 30 days, admin events without details" "(True, 2592000, False)" \
  "$(field "(d['eventsEnabled'], d['eventsExpiration'], d['adminEventsDetailsEnabled'])" <<<"$realm")"
same "e-mail goes through the SMTP service over TLS" "('smtp.example.bg', 'true', 'true')" \
  "$(field "(d['smtpServer']['host'], d['smtpServer']['starttls'], d['smtpServer']['auth'])" <<<"$realm")"
same "the realm has no users" 0 "$(kc get users -r pythagoras --fields username | field "len(d)")"
clients=$(kc get clients -r pythagoras --fields clientId,redirectUris)
same "no development client" "['pythagoras-api', 'pythagoras-cms', 'pythagoras-provisioning', 'pythagoras-web']" \
  "$(field "sorted(c['clientId'] for c in d if c['clientId'].startswith('pythagoras'))" <<<"$clients")"
same "the portal's only redirect is its own callback over HTTPS" "['https://portal.pythagoras.test:$https_port/auth/callback']" \
  "$(field "[c['redirectUris'] for c in d if c['clientId'] == 'pythagoras-web'][0]" <<<"$clients")"

# Signing in through the portal as a browser would: a parent and a member of staff.
password="Pw-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
account() { # e-mail given family: prints the Keycloak id
  kc create users -r pythagoras -s "username=$1" -s "email=$1" -s "firstName=$2" -s "lastName=$3" \
    -s enabled=true -s emailVerified=true -i
  kc set-password -r pythagoras --username "$1" --new-password "$password" >/dev/null
}
parent=$(account parent@example.bg Radost Proeva)
staff=$(account principal@example.bg Stoyan Proev)
compose exec -T postgres gosu postgres psql -X -q -v ON_ERROR_STOP=1 -d pythagoras <<SQL
BEGIN;
SET LOCAL app.actor = 'test:production-sign-in';
INSERT INTO org.education_group (id, code, name) VALUES ('a8000000-0000-7000-8000-000000000001', 'pythagoras', 'Pythagoras');
INSERT INTO people.person (id, group_id, given_name, family_name, email) VALUES
  ('c8000000-0000-7000-8000-000000000001', 'a8000000-0000-7000-8000-000000000001', 'Radost', 'Proeva', 'parent@example.bg'),
  ('c8000000-0000-7000-8000-000000000002', 'a8000000-0000-7000-8000-000000000001', 'Stoyan', 'Proev', 'principal@example.bg');
INSERT INTO people.login_identity (person_id, group_id, provider, subject) VALUES
  ('c8000000-0000-7000-8000-000000000001', 'a8000000-0000-7000-8000-000000000001', 'keycloak', '$parent'),
  ('c8000000-0000-7000-8000-000000000002', 'a8000000-0000-7000-8000-000000000001', 'keycloak', '$staff');
INSERT INTO access.role_assignment (group_id, person_id, role_code)
VALUES ('a8000000-0000-7000-8000-000000000001', 'c8000000-0000-7000-8000-000000000002', 'group_admin');
COMMIT;
SQL
printf '{"parent": {"email": "parent@example.bg", "password": "%s", "name": "Radost"},\n "staff": {"email": "principal@example.bg", "password": "%s", "name": "Stoyan"}}\n' \
  "$password" "$password" >"$work/users.json"
PYTHONIOENCODING=utf-8 "$PY" scripts/prod-signin-check.py "$ca" "$https_port" portal.pythagoras.test "$(host_path "$work/users.json")" || failed=1
logins=$(kc get events -r pythagoras -q type=LOGIN --fields type | field "len(d)")
if [[ "$logins" -ge 3 ]]; then ok "the sign-ins are recorded as events ($logins)"; else fail "sign-ins are not recorded ($logins)"; fi

# Encrypted connections inside the host (M8.4). The PgBouncer container has the
# PostgreSQL client and the API role's password, so it tries each way in.
connects() { # libpq connection string: succeeds when SELECT 1 works
  compose exec -T pgbouncer sh -c 'PGPASSWORD="$(cat /run/secrets/pg_api_password)" PGCONNECT_TIMEOUT=5 \
    psql -XtAq "$1 dbname=pythagoras user=pyth_api" -c "SELECT 1"' sh "$1" >/dev/null 2>&1
}
verified='sslmode=verify-full sslrootcert=/run/secrets/tls_ca_crt'
if connects "host=postgres $verified"; then ok "PostgreSQL accepts TLS with a certificate for its name"; else fail "PostgreSQL refused a verified TLS connection"; fi
if connects "host=postgres sslmode=disable"; then fail "PostgreSQL accepts a connection without TLS"; else ok "PostgreSQL refuses a connection without TLS"; fi
if connects "host=pgbouncer port=6432 $verified"; then ok "PgBouncer accepts TLS with a certificate for its name"; else fail "PgBouncer refused a verified TLS connection"; fi
if connects "host=pgbouncer port=6432 sslmode=disable"; then fail "PgBouncer accepts a connection without TLS"; else ok "PgBouncer refuses a connection without TLS"; fi
postgres_ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"${project}_data\").IPAddress}}" "$(compose ps -q postgres)")
if connects "host=$postgres_ip $verified"; then
  fail "a certificate is accepted for a name it does not carry"
else
  ok "a certificate is refused for a name it does not carry"
fi
if compose exec -T redis sh -c 'REDISCLI_AUTH="$(cat /run/secrets/redis_health_password)" redis-cli --no-auth-warning --user pyth_health -h 127.0.0.1 ping' 2>/dev/null | grep -q PONG; then
  fail "Redis answers without TLS"
else
  ok "Redis answers only over TLS"
fi
pgbouncer_ip=$(docker inspect -f "{{(index .NetworkSettings.Networks \"${project}_data\").IPAddress}}" "$(compose ps -q pgbouncer)")
connections=$(sql "SELECT count(*) || ' ' || bool_and(s.ssl AND s.version = 'TLSv1.3')
                     || ' ' || bool_and(a.client_addr = '$pgbouncer_ip'::inet OR a.usename NOT IN ('pyth_api', 'pyth_worker'))
                     || ' ' || count(*) FILTER (WHERE a.usename IN ('pyth_api', 'pyth_worker'))
                     FROM pg_stat_activity a JOIN pg_stat_ssl s USING (pid) WHERE a.client_addr IS NOT NULL")
read -r total encrypted pooled pooled_count <<<"$connections"
if [[ "$total" -gt 0 && "$encrypted" == true ]]; then ok "all $total network connections to PostgreSQL use TLS 1.3"; else fail "unencrypted connections: $connections"; fi
if [[ "$pooled_count" -gt 0 && "$pooled" == true ]]; then ok "the API and the worker reach PostgreSQL only through PgBouncer"; else fail "API or worker connections bypass PgBouncer: $connections"; fi

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

for service in api worker web cms gateway pgbouncer storage-init migrate; do
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
