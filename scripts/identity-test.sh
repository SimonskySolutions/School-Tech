#!/usr/bin/env bash
# Identity checks against the running Keycloak and the seeded database:
# realm security settings, client configuration, real token issuance for
# synthetic users, and the link from a Keycloak subject to a person and that
# person's row-level-security view. Requires: compose stack up, seed loaded.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

# Schools and companies the onboarding tests add would change the counts below.
bash scripts/db-reset-test-data.sh

KC=${KEYCLOAK_URL:-http://localhost:${KEYCLOAK_HOST_PORT:-58080}}
REALM=pythagoras
ISSUER="$KC/realms/$REALM"
PY=$(command -v python3 || command -v python)
failures=0

check() {
  local name=$1; shift
  if "$@"; then echo "ok - $name"; else echo "not ok - $name"; failures=$((failures + 1)); fi
}
json() { "$PY" -c "import sys, json; d = json.load(sys.stdin); print($1)"; }
jwt_claims() { "$PY" -c "
import sys, json, base64
p = sys.stdin.read().strip().split('.')[1]
print(json.dumps(json.loads(base64.urlsafe_b64decode(p + '=' * (-len(p) % 4)))))"; }
token_for() {
  curl -fsS -X POST "$ISSUER/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=pythagoras-dev-tests -d scope=openid \
    --data-urlencode "username=$1" --data-urlencode "password=$(cat secrets/keycloak_dev_user_password)" \
    | json "d['access_token']"
}
# Runs SQL as the API role with the given person context (empty = none).
as_api() {
  docker compose exec -T postgres sh -c \
    "PGPASSWORD=\"\$(cat /run/secrets/pg_api_password)\" psql -X -q -tA -v ON_ERROR_STOP=1 -h 127.0.0.1 -U pyth_api -d pythagoras" <<SQL
BEGIN;
SELECT set_config('app.person_id', '$1', true) \g /dev/null
$2
COMMIT;
SQL
}

echo "# realm configuration"
discovery=$(curl -fsS "$ISSUER/.well-known/openid-configuration")
check "issuer is $ISSUER" test "$(echo "$discovery" | json "d['issuer']")" = "$ISSUER"

admin_token=$(curl -fsS -X POST "$KC/realms/master/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=admin-cli -d username=admin \
  --data-urlencode "password=$(cat secrets/keycloak_admin_password)" | json "d['access_token']")
realm=$(curl -fsS -H "Authorization: Bearer $admin_token" "$KC/admin/realms/$REALM")
check "self-registration is disabled"       test "$(echo "$realm" | json "d['registrationAllowed']")" = "False"
check "brute-force protection is on"        test "$(echo "$realm" | json "d['bruteForceProtected']")" = "True"
check "password policy requires 12+ chars"  bash -c "echo '$(echo "$realm" | json "d.get('passwordPolicy', '')")' | grep -q 'length(12)'"
check "access tokens live 5 minutes"        test "$(echo "$realm" | json "d['accessTokenLifespan']")" = "300"
check "refresh tokens rotate"               test "$(echo "$realm" | json "d['revokeRefreshToken']")" = "True"
check "TLS required for external requests"  test "$(echo "$realm" | json "d['sslRequired']")" = "external"

web=$(curl -fsS -H "Authorization: Bearer $admin_token" "$KC/admin/realms/$REALM/clients?clientId=pythagoras-web" | json "json.dumps(d[0])")
check "web client is confidential"          test "$(echo "$web" | json "d['publicClient']")" = "False"
check "web client uses code flow only"      test "$(echo "$web" | json "(d['standardFlowEnabled'], d['implicitFlowEnabled'], d['directAccessGrantsEnabled'])")" = "(True, False, False)"
check "web client requires PKCE S256"       test "$(echo "$web" | json "d['attributes'].get('pkce.code.challenge.method')")" = "S256"

echo "# tokens"
anna=$(token_for anna.ivanova@pythagoras.test)
claims=$(echo "$anna" | jwt_claims)
check "token subject is Anna's Keycloak id" test "$(echo "$claims" | json "d['sub']")" = "f1000000-0000-7000-8000-000000000020"
check "token audience includes the API"     bash -c "echo '$(echo "$claims" | json "json.dumps(d['aud'])")' | grep -q pythagoras-api"
check "token issuer matches discovery"      test "$(echo "$claims" | json "d['iss']")" = "$ISSUER"
check "token expires after 5 minutes"       test "$(echo "$claims" | json "d['exp'] - d['iat']")" = "300"
# OAuth 2.0 answers bad credentials with 400 invalid_grant. A different account
# is used so repeated runs never push a real test user towards lockout.
wrong=$(curl -s -w ' %{http_code}' -X POST "$ISSUER/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=pythagoras-dev-tests -d username=unlinked@pythagoras.test -d password=wrong-password-123)
check "a wrong password is refused (400 invalid_grant)" bash -c "[[ '$wrong' == *invalid_grant*' 400' ]]"
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$ISSUER/protocol/openid-connect/token" \
  -d grant_type=password -d client_id=pythagoras-web -d username=anna.ivanova@pythagoras.test \
  --data-urlencode "password=$(cat secrets/keycloak_dev_user_password)")
check "the web client refuses password grants" test "$status" != "200"

echo "# subject to person, and what each person sees"
person_of() { as_api "" "SELECT access.resolve_login('keycloak', '$1');"; }
anna_person=$(person_of "$(echo "$claims" | json "d['sub']")")
check "Anna's token resolves to her person record" test "$anna_person" = "c1000000-0000-7000-8000-000000000020"
unlinked_sub=$(token_for unlinked@pythagoras.test | jwt_claims | json "d['sub']")
check "a Keycloak user with no person resolves to nothing" test -z "$(person_of "$unlinked_sub")"

visible() { as_api "$1" "SELECT string_agg(s.code, ',' ORDER BY s.code) FROM people.enrolment e JOIN org.school s ON s.id = e.school_id;"; }
check "Anna sees her children at School A and School C" test "$(visible "$anna_person")" = "school-a,school-c"
check "Hristo sees his child at School B only" test "$(visible c1000000-0000-7000-8000-000000000021)" = "school-b"
check "Teodora (pending request) sees no children" test -z "$(visible c1000000-0000-7000-8000-000000000022)"
check "the principal of School A sees School A only" test "$(visible c1000000-0000-7000-8000-000000000006)" = "school-a"
check "the CEO sees all three schools" test "$(visible c1000000-0000-7000-8000-000000000001)" = "school-a,school-b,school-c"
check "no person context sees nothing" test -z "$(visible '')"
check "every company order line would go to Testing Company" test \
  "$(as_api c1000000-0000-7000-8000-000000000001 "SELECT string_agg(DISTINCT le.legal_name, ',') FROM catalog.school_offering o JOIN org.legal_entity le ON le.id = o.billing_entity_id;")" = "Testing Company"

if (( failures > 0 )); then
  echo "identity: $failures check(s) failed"
  exit 1
fi
echo "identity: all checks passed"
