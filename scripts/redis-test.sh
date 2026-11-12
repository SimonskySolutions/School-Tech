#!/usr/bin/env bash
# Redis checks: ACL boundaries, required settings, and a real BullMQ round trip
# under the pyth_queue user. Requires the compose stack to be running.
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

NODE_IMAGE="node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446"
BULLMQ_VERSION="6.5.1"
IOREDIS_VERSION="6.0.0"

failures=0
cli() {
  local user=$1; shift
  docker compose exec -T redis sh -c \
    "REDISCLI_AUTH=\"\$(cat /run/secrets/redis_${user#pyth_}_password)\" redis-cli --no-auth-warning --user $user $*" 2>&1 | tr -d '\r'
}
expect() {
  local name=$1 expected=$2 actual=$3
  if [[ "$actual" == *"$expected"* ]]; then
    echo "ok - $name"
  else
    echo "not ok - $name (expected '$expected', got '$actual')"
    failures=$((failures + 1))
  fi
}

expect "default user is disabled"              "NOAUTH"      "$(docker compose exec -T redis redis-cli ping 2>&1)"
expect "queue user writes pyth:* keys"         "OK"          "$(cli pyth_queue SET pyth:redis-test 1)"
expect "queue user cannot touch other keys"    "NOPERM"      "$(cli pyth_queue SET other:redis-test 1)"
expect "queue user cannot FLUSHALL"            "NOPERM"      "$(cli pyth_queue FLUSHALL)"
expect "queue user cannot CONFIG"              "NOPERM"      "$(cli pyth_queue CONFIG GET maxmemory)"
# A pattern without wildcards: the container shell would expand "*" into file names.
expect "queue user cannot KEYS"                "NOPERM"      "$(cli pyth_queue KEYS pyth:no-such-key)"
expect "health user can only PING"             "NOPERM"      "$(cli pyth_health GET pyth:redis-test)"
expect "eviction is disabled for BullMQ"       "noeviction"  "$(cli pyth_admin CONFIG GET maxmemory-policy)"
expect "append-only persistence is on"         "yes"         "$(cli pyth_admin CONFIG GET appendonly)"
expect "AOF fsync every second"                "everysec"    "$(cli pyth_admin CONFIG GET appendfsync)"
cli pyth_admin DEL pyth:redis-test >/dev/null

if docker run --rm --network pythagoras_default \
     -e REDIS_PASSWORD="$(cat secrets/redis_queue_password)" \
     -v "$(pwd -W 2>/dev/null || pwd)/tests/redis:/src:ro" \
     "$NODE_IMAGE" sh -c "mkdir -p /tmp/w && cp /src/bullmq-smoke.mjs /tmp/w/ && cd /tmp/w \
       && npm init -y >/dev/null && npm install --no-audit --no-fund --loglevel=error bullmq@$BULLMQ_VERSION ioredis@$IOREDIS_VERSION >/dev/null \
       && node bullmq-smoke.mjs"; then
  :
else
  failures=$((failures + 1))
fi

if (( failures > 0 )); then
  echo "redis: $failures check(s) failed"
  exit 1
fi
echo "redis: all checks passed"
