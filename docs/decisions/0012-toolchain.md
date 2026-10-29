# 0012 Toolchain and workspace

Date: 2026-10-29 · Status: Accepted

## Decision

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 24.22.2 LTS | Image `node:24-trixie-slim@sha256:54f84b4cf8432b21aaffd5d3ce8d41e12cea0d10d33c09d2f3c9879d49d6b446`. Node 26 becomes LTS later; 24 is supported to April 2028 |
| pnpm | 12.16.1 | Workspace with `apps/*` and `packages/*`; lockfile committed; install scripts run only for packages approved in `allowBuilds` (`@swc/core`, `unrs-resolver`). `msgpackr-extract` (an optional native speed-up pulled in by BullMQ) is explicitly denied; its JavaScript fallback is used. pnpm's minimum-release-age protection is on, with one exception recorded in `minimumReleaseAgeExclude`: `jose@6.2.14`, which was newer than the threshold when it was added in M1.3. Remove the exception once a later `jose` release passes the threshold |
| TypeScript | 6.0.3 | **Not 7.0**: TypeScript 7 (the native compiler) is the latest release, but typescript-eslint 8.72 supports TypeScript below 6.1 and the NestJS CLI ships with ~6.0. Revisit when both support 7 |
| NestJS | 12.3 (Express adapter) | API in `apps/api`, CommonJS output |
| Next.js / React | 16.4 / 19.3 | Web in `apps/web`, App Router |
| ESLint | 10.13 with typescript-eslint 8.72 (type-aware rules); **9.39 in `apps/web`** with eslint-config-next 16.4 | Flat config per package, shared base at the root. The React, accessibility and import plugins used by eslint-config-next do not support ESLint 10 yet. ESLint 9 is marked deprecated on npm; as a development-only tool that is acceptable short-term. Move the web app to 10 as soon as those plugins support it |
| Prettier | 3.9 | Formatting only; ESLint does not format |
| Vitest | 5.0 (with unplugin-swc for NestJS decorators) | One test runner for every package |
| `@pythagoras/shared` | workspace package | ESM; consumed by the API (Node 24 `require(esm)`) and the web app |

**Where things run.** Nobody needs Node.js installed. All commands run in a development container built from the pinned Node image (`scripts/pnpm.sh`). Dependencies (`node_modules`, the pnpm store) and build output (`dist`, `.next`) live in Docker volumes, not in the project folder, because the folder is synced by OneDrive: hundreds of thousands of small files must not be uploaded to a personal cloud, and file locking by the sync client breaks installs.

**Containers run as the unprivileged `node` user.** The entrypoint only fixes ownership of the dependency volumes, then drops root.

## Consequences

- File watching from Windows into containers uses polling (`WATCHPACK_POLLING`, `CHOKIDAR_USEPOLLING`), which is slower than native events but reliable.
- Upgrading a tool means changing one pin, re-running `scripts/check.sh`, and updating this record.
