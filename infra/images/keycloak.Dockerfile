# syntax=docker/dockerfile:1.7
# Production identity provider (ADR 0009, 0033): Keycloak built once for
# PostgreSQL with the Pythagoras theme inside, then started with --optimized.
# Build from the repository root:
#   docker build -f infra/images/keycloak.Dockerfile -t pythagoras-keycloak .

FROM quay.io/keycloak/keycloak:26.8.1@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b AS build
# Build-time options; everything else (host name, database address) is set when it starts.
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true KC_FEATURES_DISABLED=twitter-broker
COPY infra/keycloak/themes/pythagoras /opt/keycloak/themes/pythagoras
RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.8.1@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b
COPY --from=build /opt/keycloak/ /opt/keycloak/
# Reads the secret files into the variables Keycloak expects (the image itself holds none).
COPY infra/keycloak/entrypoint.sh /opt/pythagoras/keycloak-entrypoint.sh
# The base image runs as the unprivileged user 1000.
ENTRYPOINT ["/bin/bash", "/opt/pythagoras/keycloak-entrypoint.sh"]
CMD ["start", "--optimized"]
