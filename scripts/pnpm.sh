#!/usr/bin/env bash
# Runs pnpm inside the development container (no local Node.js needed).
#   scripts/pnpm.sh install
#   scripts/pnpm.sh --filter @pythagoras/api test
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1
exec docker compose run --rm --no-TTY workspace pnpm "$@"
