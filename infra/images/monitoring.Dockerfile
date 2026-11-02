# syntax=docker/dockerfile:1.7
# Monitoring for production (M8.6, ADR 0036): Prometheus, Alertmanager and the
# exporters, each the upstream project's release pinned by digest, in one
# image with the platform's configuration, alert rules and their tests. Every
# monitoring service runs from it as "nobody"; infra/monitoring/run.sh picks
# the part. Build from the repository root:
#   docker build -f infra/images/monitoring.Dockerfile -t pythagoras-monitoring .

FROM prom/alertmanager:v0.34.1@sha256:e9733bafb1bdef9b00e25a21f8f99dc26a22224bf16641ad754d1649f4c3357a AS alertmanager
FROM prom/node-exporter:v1.12.1@sha256:1b4e4438faca4dd7e001dd445d161a4a2091b0fededa84093b3a8dfeae1f1be0 AS node-exporter
FROM prom/blackbox-exporter:v0.29.1@sha256:ea1c7aa3ef3f307cd03e85f34abb604478ccb90b567fc690da0cd9776da76b13 AS blackbox
FROM prometheuscommunity/postgres-exporter:v0.20.1@sha256:ac5ec343104fae0e2d84a27bb8d69b38430a11910c5382cad85d478d2bab713e AS postgres-exporter
FROM prometheuscommunity/pgbouncer-exporter:v0.12.1@sha256:30f31b6c2efdad3647f8182cc7c1a3a19e42bae5d17387694989f969371c230d AS pgbouncer-exporter
FROM oliver006/redis_exporter:v1.94.0@sha256:0842ef7110e62b40bbde2d5c11f38c6fbd99f7100c75e3866637c1b335a1eff7 AS redis-exporter

FROM prom/prometheus:v3.13.5@sha256:aafa9d694e6a883c02db516d9f6e5b84e14195f49a2a6456a4cca815edda72b9
COPY --from=alertmanager /bin/alertmanager /bin/amtool /bin/
COPY --from=alertmanager --chown=nobody:nobody /alertmanager /alertmanager
COPY --from=node-exporter /bin/node_exporter /bin/
COPY --from=blackbox /bin/blackbox_exporter /bin/
COPY --from=postgres-exporter /bin/postgres_exporter /bin/
COPY --from=pgbouncer-exporter /bin/pgbouncer_exporter /bin/
COPY --from=redis-exporter /redis_exporter /bin/
COPY infra/monitoring/ /etc/pythagoras-monitoring/
USER nobody
ENTRYPOINT ["/bin/sh", "/etc/pythagoras-monitoring/run.sh"]
CMD ["prometheus"]
