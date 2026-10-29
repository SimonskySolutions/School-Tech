#!/bin/sh
# Named volumes start out owned by root. Give the dependency and build volumes
# to the unprivileged node user, then run the command as that user.
set -eu

for dir in \
  /workspace/node_modules \
  /workspace/apps/api/node_modules /workspace/apps/api/dist \
  /workspace/apps/web/node_modules /workspace/apps/web/.next \
  /workspace/packages/shared/node_modules /workspace/packages/shared/dist; do
  if [ -d "$dir" ] && [ "$(stat -c %u "$dir")" != "1000" ]; then
    chown node:node "$dir"
  fi
done

if [ "$(id -u)" = "0" ]; then
  export HOME=/home/node USER=node
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
