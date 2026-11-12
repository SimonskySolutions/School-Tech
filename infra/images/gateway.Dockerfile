# syntax=docker/dockerfile:1.7
# Production gateway (ADR 0015, 0033): Caddy with the production configuration
# inside. Host names come from the environment when it starts.
# Build from the repository root:
#   docker build -f infra/images/gateway.Dockerfile -t pythagoras-gateway .

FROM caddy:2.11.7-alpine@sha256:eb4d35b7452d1ab6171fbdbe8d9275b2301dad6dad92115d91e19fb9b24d510f
COPY infra/gateway/Caddyfile.production /etc/caddy/Caddyfile
