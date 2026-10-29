#!/bin/bash
# Runs once, when the data volume is empty (docker-entrypoint-initdb.d).
# Schema objects come from migrations, not from here.
#
# The image's entrypoint executes this file when it is executable and *sources*
# it otherwise (for example after a checkout that lost the executable bit). It
# therefore must not use exec or change shell options: either would leak into
# the entrypoint and stop the real server from starting. apply.sh runs in its
# own shell with strict settings; a failure there fails initialisation.
bash /opt/pythagoras/db/bootstrap/apply.sh
