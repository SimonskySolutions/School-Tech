#!/usr/bin/env bash
# Gateway checks from the host: host-name routing, the canonical portal
# redirect, the API's limited public surface, refusal of unknown hosts, and
# headers that must or must not appear. Requires the stack to be running.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=${GATEWAY_HOST_PORT:-53000}
failures=0
# curl resolves *.localhost to 127.0.0.1; other names are pinned explicitly.
probe() { curl -s -o /dev/null -D - --resolve "elsewhere.example.test:$PORT:127.0.0.1" "$1" | tr -d '\r'; }
status() { probe "$1" | head -1 | cut -d' ' -f2; }
check() {
  local name=$1; shift
  if "$@"; then echo "ok - $name"; else echo "not ok - $name"; failures=$((failures + 1)); fi
}

portal="http://portal.pythagoras.localhost:$PORT"
check "localhost redirects to the canonical portal address" \
  bash -c "curl -s -o /dev/null -w '%{http_code} %{redirect_url}' http://localhost:$PORT/children | grep -qx '308 $portal/children'"
check "the portal is served by the web app"            test "$(status "$portal/")" = "200"
check "the CMS has its own host (public website list)" test "$(status "http://cms.pythagoras.localhost:$PORT/api/websites?limit=1")" = "200"
check "school websites reach the web app"              test "$(status "http://school-c.pythagoras.localhost:$PORT/")" = "200"
check "the API answers its health check publicly"      test "$(status "http://api.pythagoras.localhost:$PORT/health/ready")" = "200"
check "the API's other routes are not public"          test "$(status "http://api.pythagoras.localhost:$PORT/me")" = "404"
# Provider webhooks reach the API (which refuses this unsigned one), as does the
# development provider's checkout page (an unknown token is the API's 404 page).
check "provider webhooks reach the API"                test "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' -d '{}' "http://api.pythagoras.localhost:$PORT/webhooks/development")" = "400"
check "the development checkout page reaches the API"   bash -c "curl -s http://api.pythagoras.localhost:$PORT/dev-payments/checkout/unknown | grep -q 'unknown checkout'"
check "an unknown host is refused (421)"               test "$(status "http://elsewhere.example.test:$PORT/")" = "421"
no_server_header() { ! probe "$1" | grep -qi '^server:'; }
for url in "$portal/" "http://localhost:$PORT/" "http://elsewhere.example.test:$PORT/" "http://api.pythagoras.localhost:$PORT/health/live"; do
  check "no Server header on $url"                     no_server_header "$url"
done
check "the gateway adds a request id the API echoes" \
  bash -c "curl -s -D - -o /dev/null http://api.pythagoras.localhost:$PORT/health/live | grep -qiE '^x-request-id: [0-9a-f-]{36}'"
check "web security headers pass through the gateway" \
  bash -c "curl -s -D - -o /dev/null $portal/ | grep -qi '^x-frame-options: DENY'"

if (( failures > 0 )); then echo "gateway: $failures check(s) failed"; exit 1; fi
echo "gateway: all checks passed"
