# syntax=docker/dockerfile:1.7
# Production Redis (ADR 0033): the official image with the platform's
# configuration and the entrypoint that builds the ACL file from secret files.
# Build from the repository root:
#   docker build -f infra/images/redis.Dockerfile -t pythagoras-redis .

FROM redis:8.10.2-trixie@sha256:97ec88159e6d7cfb5ddef9015386087d58a912de80112f06ebdfa78fa5989901
COPY infra/redis/redis.conf /usr/local/etc/redis/redis.conf
COPY infra/redis/entrypoint.sh /opt/pythagoras/redis-entrypoint.sh
# The official entrypoint drops to the "redis" user before the server starts.
ENTRYPOINT ["/bin/sh", "/opt/pythagoras/redis-entrypoint.sh"]
