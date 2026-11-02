# syntax=docker/dockerfile:1.7
# Production PostgreSQL (ADR 0033): the official image with the platform's
# configuration and first-start bootstrap (roles, databases) inside, so the
# host needs no source tree. Schema objects come from the migration job.
# Accepts only TLS from the network (M8.4): pg_hba.production.conf and the
# certificate from the secrets. Archives its write-ahead log continuously with
# pgBackRest (M8.5, ADR 0035); the same image runs the backup service, which
# also copies the documents with rclone, and the restore drill and a lost
# server's restore run from it too (M8.7). Build from the repository root:
#   docker build -f infra/images/postgres.Dockerfile -t pythagoras-postgres .

# rclone from the project's release, checked against its published checksums.
FROM postgres:18.6-trixie@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4 AS rclone
ARG TARGETARCH
ARG RCLONE_VERSION=v1.75.2
ARG RCLONE_SHA256_amd64=349ac8fba6ff65d6247043f1750cdcb518ec5d500ef91463a10d37c0ccdf3702
ARG RCLONE_SHA256_arm64=7e1e8d69654941b7b7df84ee74c5f7fb09cce7d5496947fb7bf16b55ff427d10
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip \
 && rm -rf /var/lib/apt/lists/*
RUN arch=${TARGETARCH:-amd64}; eval "sum=\$RCLONE_SHA256_$arch" \
 && curl -fsSLo /tmp/rclone.zip "https://downloads.rclone.org/$RCLONE_VERSION/rclone-$RCLONE_VERSION-linux-$arch.zip" \
 && echo "$sum  /tmp/rclone.zip" | sha256sum -c - \
 && unzip -q -j /tmp/rclone.zip "rclone-$RCLONE_VERSION-linux-$arch/rclone" -d /out \
 && chmod 755 /out/rclone

FROM postgres:18.6-trixie@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates jq pgbackrest=2.60.0-1.pgdg13+1 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=rclone /out/rclone /usr/local/bin/rclone
COPY infra/postgres/postgresql.conf /etc/postgresql/postgresql.conf
COPY infra/postgres/pg_hba.production.conf /etc/postgresql/pg_hba.conf
COPY infra/postgres/initdb/ /docker-entrypoint-initdb.d/
COPY db/bootstrap/ /opt/pythagoras/db/bootstrap/
# The restore drill counts every table with it (M8.7).
COPY db/ops/row_counts.sql /opt/pythagoras/db/ops/row_counts.sql
COPY infra/postgres/production-entrypoint.sh /usr/local/bin/pythagoras-entrypoint.sh
# pgBackRest: the database's side by default, the repository's for the backup service.
COPY infra/pgbackrest/database.conf /etc/pgbackrest/pgbackrest.conf
COPY infra/pgbackrest/repository.conf /etc/pgbackrest/repository.conf
COPY --chmod=755 infra/pgbackrest/backup.sh /usr/local/bin/pythagoras-backup
# The backup service's lasting state and its measures for monitoring (M8.6);
# a new volume takes this owner, and the host's exporter may read the measures.
RUN install -d -o postgres -g postgres -m 755 /var/lib/pythagoras-backup /var/lib/pythagoras-backup/metrics
# Starts as root only to place the certificate and fix ownership of the data
# directory; the server runs as the "postgres" user.
ENTRYPOINT ["/bin/bash", "/usr/local/bin/pythagoras-entrypoint.sh"]
CMD ["postgres", "-c", "config_file=/etc/postgresql/postgresql.conf", "-c", "hba_file=/etc/postgresql/pg_hba.conf", \
     "-c", "ssl=on", "-c", "ssl_cert_file=/run/postgresql-tls/server.crt", "-c", "ssl_key_file=/run/postgresql-tls/server.key", \
     "-c", "ssl_min_protocol_version=TLSv1.3", \
     "-c", "archive_mode=on", "-c", "archive_command=pgbackrest --stanza=pythagoras archive-push %p", "-c", "archive_timeout=60"]
