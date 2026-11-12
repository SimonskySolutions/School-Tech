# syntax=docker/dockerfile:1.7
# Production image for the website CMS (Payload in a Next.js standalone server).
# It applies its own generated migrations when it starts (ADR 0033). Build from
# the repository root:
#   docker build -f infra/images/cms.Dockerfile -t pythagoras-cms .

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS build
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --no-fund --no-audit pnpm@12.16.1 && npm cache clean --force
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/cms/package.json apps/cms/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@pythagoras/cms..."

COPY packages/shared packages/shared
COPY apps/cms apps/cms
# The build loads the configuration; it never sees a real secret (see payload.config.ts).
RUN pnpm --filter @pythagoras/cms build

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=root:root /src/apps/cms/.next/standalone ./
COPY --from=build --chown=root:root /src/apps/cms/.next/static ./apps/cms/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/cms/server.js"]
