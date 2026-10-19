# ADR 0001: Phase 0 stack and tooling

- **Status:** Accepted
- **Date:** 2026-10-19
- **Context source:** OpenSpec change `phase-0-foundation` (`openspec/changes/phase-0-foundation/design.md`)

## Context

Phase 0 builds a runnable skeleton (web, API, reviewer, PostgreSQL, Redis) with lint, typecheck, tests and CI, so that Phase 1 (GitHub integration) builds on proven ground. `AGENTS.md` fixes the broad stack: React/Vite, NestJS, PostgreSQL with Prisma, Redis with BullMQ, and a Python 3.12 reviewer. This ADR records the specific choices made within that stack, and the alternatives considered.

## Decisions

| #   | Decision                                                                                                               | Alternatives considered                  | Why                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| D1  | pnpm workspaces (`apps/*`, `packages/*`), pinned `pnpm@9.15.9`; no Turborepo/Nx                                        | Turborepo, Nx, npm workspaces            | Two TS packages don't justify another build framework. Revisit if CI gets slow.                                           |
| D2  | Shared strict `tsconfig.base.json` in `packages/config`; one root ESLint flat config (type-checked) plus Prettier      | Per-package ESLint configs               | Less drift. Type-aware rules catch floating promises in async backend code.                                               |
| D3  | Hand-written NestJS API, CommonJS output, `/api/v1` via global prefix and URI versioning                               | `nest new` generator                     | The generator creates its own git repo and lint setup. CommonJS is the most reliable setup for Nest, Jest and decorators. |
| D4  | Startup config validation with zod (API) and pydantic-settings (reviewer); errors name variables, never values         | `@nestjs/config` + Joi                   | One schema library, fewer layers, and values (which may hold credentials) never reach logs.                               |
| D5  | Prisma installed now with an empty schema; ioredis for Redis                                                           | Plain `pg` driver now, Prisma in Phase 1 | Proves client generation, the CI step and the Docker build before tables exist. BullMQ requires ioredis.                  |
| D6  | Liveness makes no I/O; readiness checks dependencies concurrently with a 2 s timeout each; fixed error categories      | `@nestjs/terminus`                       | No extra dependency; the response shape is the same across API and reviewer; no error text leaks.                         |
| D7  | Built-in Nest JSON `ConsoleLogger`; stdlib JSON formatter in Python                                                    | `nestjs-pino`                            | Structured logs with no dependencies. Revisit in Phase 3 (observability).                                                 |
| D8  | Web: Vite + React + TanStack Query + React Router; `/api` same-origin through the Vite proxy (dev) and nginx (Compose) | CORS between origins                     | No CORS configuration, and Phase 1 session cookies can be same-site.                                                      |
| D8b | Jest for the API, Vitest for the web                                                                                   | Vitest everywhere                        | Vitest (esbuild) doesn't emit decorator metadata, which Nest DI needs, without an SWC plugin.                             |
| D9  | Reviewer as a small FastAPI process managed by uv; queue consumer joins the same process in Phase 1                    | Worker with no HTTP server               | Container healthchecks and the CI smoke test need an HTTP health endpoint.                                                |
| D10 | Multi-stage, non-root images; Compose with healthchecks and `service_healthy` ordering; host ports on 127.0.0.1        | Single-stage images, `curl` in images    | Smaller images, least privilege, deterministic startup order.                                                             |
| D11 | One GitHub Actions workflow: `node`, `python` and `compose-smoke` jobs; read-only token; no secrets                    | Separate workflows per language          | One status for pull requests; fork PRs can run every gate.                                                                |
| D12 | `git init` with `.gitattributes eol=lf`                                                                                | Platform line endings                    | Windows checkouts must not break shell or nginx files in Linux containers.                                                |

## Version pins decided during implementation

These changed from "latest" during implementation, for the reasons given:

| Pin                                          | Reason                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript `~6.0`                            | TypeScript 7 had just been released, and `typescript-eslint` supports only versions below 6.1.                                  |
| NestJS 11, Prisma 6, ioredis 5               | NestJS 12 is ESM-only, which conflicts with D3/D8b. Prisma 7 needs Node ≥ 22.12. ioredis 5 is the line BullMQ is built against. |
| Node ≥ 22.22 (`.nvmrc`, `node:22.22-alpine`) | Current Vite, Vitest, React Router and jsdom require it.                                                                        |
| `astral-sh/setup-uv@v10.3.0` (exact tag)     | That action publishes no moving major tag.                                                                                      |
| Compose PostgreSQL on host port 5433         | Avoids clashing with a locally installed PostgreSQL on 5432. Configurable via `POSTGRES_HOST_PORT`.                             |

Moving to NestJS 12 and Prisma 7 (ESM API, Vitest with SWC) is deferred to its own change.

## Consequences

- The repository builds, tests and starts with one command per layer, and CI enforces the same gates.
- Two TypeScript test runners must be maintained. Both run through `pnpm test`.
- Older NestJS and Prisma majors will need a planned upgrade.
- The readiness endpoint is public and reveals dependency state. Accepted for Phase 0 (no hosts or errors exposed). See T20 in [threat-model.md](../threat-model.md).
