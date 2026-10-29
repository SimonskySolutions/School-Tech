# Development toolchain image: pinned Node.js and pnpm. Source is bind-mounted;
# dependencies and build output live in named volumes (ADR 0012).
FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446

ENV NEXT_TELEMETRY_DISABLED=1 \
    PNPM_HOME=/home/node/.local/share/pnpm

RUN npm install --global --no-fund --no-audit pnpm@12.16.1 \
 && npm cache clean --force \
 && mkdir -p /workspace \
 && chown node:node /workspace

COPY entrypoint.sh /usr/local/bin/dev-entrypoint
RUN chmod 0755 /usr/local/bin/dev-entrypoint

WORKDIR /workspace
ENTRYPOINT ["dev-entrypoint"]
CMD ["pnpm", "--version"]
