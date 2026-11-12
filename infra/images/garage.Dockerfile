# syntax=docker/dockerfile:1.7
# Production object store (ADR 0029, 0033): Garage with its production
# configuration inside, running as an unprivileged user. Build from the
# repository root:
#   docker build -f infra/images/garage.Dockerfile -t pythagoras-garage .

# The upstream image has no shell, so its data directories are made here; a
# new named volume takes their owner from the image.
FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS directories
RUN mkdir -p /out/var/lib/garage/meta /out/var/lib/garage/data

FROM dxflrs/garage:v2.4.1@sha256:9c96caa2612d3411acc5b0e6701fb238dbfba33e533a6d7d3d811a4b12d0d020
COPY --from=directories --chown=1000:1000 /out/var/lib/garage /var/lib/garage
COPY infra/garage/garage.production.toml /etc/garage.toml
USER 1000:1000
