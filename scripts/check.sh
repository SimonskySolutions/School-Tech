#!/usr/bin/env bash
# The code checks CI runs: install from the lockfile, build the shared package,
# then type check, lint, format check, unit tests and production builds.
#   scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
export MSYS_NO_PATHCONV=1

docker compose build --quiet workspace
docker compose run --rm --no-TTY workspace sh -c '
  set -e
  step() { printf "\n== %s\n" "$1"; }
  step "install (frozen lockfile)";  pnpm install --frozen-lockfile --reporter=append-only | tail -n 3
  step "build shared package";       pnpm --filter @pythagoras/shared build
  step "type check";                 pnpm -r run typecheck
  step "lint";                       pnpm -r run lint
  step "format";                     pnpm format:check
  step "unit tests";                 pnpm -r run test
  step "production builds";          pnpm -r run build
  printf "\ncheck: all steps passed\n"
'
