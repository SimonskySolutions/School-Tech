# syntax=docker/dockerfile:1.7
# Production PostgreSQL (ADR 0033): the official image with the platform's
# configuration and first-start bootstrap (roles, databases) inside, so the
# host needs no source tree. Schema objects come from the migration job.
# Accepts only TLS from the network (M8.4): pg_hba.production.conf and the
# certificate from the secrets. Build from the repository root:
#   docker build -f infra/images/postgres.Dockerfile -t pythagoras-postgres .

FROM postgres:18.6-trixie@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4
COPY infra/postgres/postgresql.conf /etc/postgresql/postgresql.conf
COPY infra/postgres/pg_hba.production.conf /etc/postgresql/pg_hba.conf
COPY infra/postgres/initdb/ /docker-entrypoint-initdb.d/
COPY db/bootstrap/ /opt/pythagoras/db/bootstrap/
COPY infra/postgres/production-entrypoint.sh /usr/local/bin/pythagoras-entrypoint.sh
# Starts as root only to place the certificate and fix ownership of the data
# directory; the server runs as the "postgres" user.
ENTRYPOINT ["/bin/bash", "/usr/local/bin/pythagoras-entrypoint.sh"]
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "hba_file=/etc/postgresql/pg_hba.conf", \
     "-c", "ssl=on", "-c", "ssl_cert_file=/run/postgresql-tls/server.crt", "-c", "ssl_key_file=/run/postgresql-tls/server.key", \
     "-c", "ssl_min_protocol_version=TLSv1.3"]
