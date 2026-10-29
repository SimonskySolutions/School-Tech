# syntax=docker/dockerfile:1.7
# Production image for the API and the background worker (one image, two
# commands). Build from the repository root:
#   docker build -f infra/images/api.Dockerfile -t pythagoras-api .
# API:    docker run pythagoras-api
# Worker: docker run pythagoras-api node dist/worker/main.js

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS build
ENV CI=true
RUN npm install --global --no-fund --no-audit pnpm@12.16.1 && npm cache clean --force
WORKDIR /src

# Dependencies first, from the lockfile only, so this layer is reused until they change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store --filter "@pythagoras/api..."

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @pythagoras/shared build \
 && pnpm --filter @pythagoras/api build \
 && pnpm --filter @pythagoras/api deploy --legacy --prod /out

FROM node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446 AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=root:root /out ./
# Code is owned by root and read-only to the process; it runs as "node".
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
