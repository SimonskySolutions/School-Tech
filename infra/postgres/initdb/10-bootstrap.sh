#!/bin/bash
# Runs once, when the data volume is empty (docker-entrypoint-initdb.d).
# Schema objects come from migrations, not from here.
set -euo pipefail
exec bash /opt/pythagoras/db/bootstrap/apply.sh
