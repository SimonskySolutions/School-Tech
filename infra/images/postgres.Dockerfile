# syntax=docker/dockerfile:1.7
# Production PostgreSQL (ADR 0033): the official image with the platform's
# configuration and first-start bootstrap (roles, databases) inside, so the
# host needs no source tree. Schema objects come from the migration job.
# Build from the repository root:
#   docker build -f infra/images/postgres.Dockerfile -t pythagoras-postgres .

FROM postgres:18.6-trixie@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4
COPY infra/postgres/postgresql.conf infra/postgres/pg_hba.conf /etc/postgresql/
COPY infra/postgres/initdb/ /docker-entrypoint-initdb.d/
COPY db/bootstrap/ /opt/pythagoras/db/bootstrap/
# The official entrypoint starts as root only to fix ownership of the data
# directory, then runs the server as the "postgres" user.
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "hba_file=/etc/postgresql/pg_hba.conf"]
