# syntax=docker/dockerfile:1.7
# Production image for the web app (Next.js standalone server). Build from the
# repository root:
#   docker build -f infra/images/web.Dockerfile -t pythagoras-web .

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS build
ENV CI=true NEXT_TELEMETRY_DISABLED=1
RUN npm install --global --no-fund --no-audit pnpm@12.16.1 && npm cache clean --force
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@pythagoras/web..."

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN pnpm --filter @pythagoras/shared build && pnpm --filter @pythagoras/web build

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
# The standalone output carries only the files the server needs.
COPY --from=build --chown=root:root /src/apps/web/.next/standalone ./
COPY --from=build --chown=root:root /src/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
