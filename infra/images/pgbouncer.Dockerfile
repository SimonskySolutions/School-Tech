# syntax=docker/dockerfile:1.7
# Connection pooler for production (M8.4, ADR 0033): PgBouncer from the
# PostgreSQL project's packages on the same pinned base as the database, with
# its configuration inside; it runs as the unprivileged "postgres" user.
# Build from the repository root:
#   docker build -f infra/images/pgbouncer.Dockerfile -t pythagoras-pgbouncer .

FROM postgres:18.6-trixie@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4
RUN apt-get update \
 && apt-get install -y --no-install-recommends pgbouncer=1.26.1-1.pgdg13+1 \
 && rm -rf /var/lib/apt/lists/*
COPY infra/pgbouncer/pgbouncer.ini /etc/pgbouncer/pgbouncer.ini
COPY infra/pgbouncer/entrypoint.sh /usr/local/bin/pgbouncer-entrypoint.sh
USER postgres
EXPOSE 6432
ENTRYPOINT ["/bin/sh", "/usr/local/bin/pgbouncer-entrypoint.sh"]
