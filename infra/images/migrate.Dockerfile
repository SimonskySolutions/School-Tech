# syntax=docker/dockerfile:1.7
# The one-off migration job (ADR 0033): dbmate with the platform's migrations
# inside. A release runs it before the applications; if a migration fails, its
# transaction rolls back, the job exits non-zero and the release stops.
# Build from the repository root:
#   docker build -f infra/images/migrate.Dockerfile -t pythagoras-migrate .

FROM ghcr.io/amacneil/dbmate:2.34.1@sha256:3298bdfcb651af608e06d2e13ae12398c4056e5326d38ef31885973d83248d9c
COPY db/migrations /db/migrations
COPY infra/images/migrate/entrypoint.sh /usr/local/bin/pythagoras-migrate
USER 65534:65534
ENTRYPOINT ["/bin/sh", "/usr/local/bin/pythagoras-migrate"]
CMD ["up"]
