# Proposal

## Why

The repository only has `AGENTS.md` and OpenSpec setup, so there is nothing that runs, builds, or tests yet. Phase 0 (Foundation) builds a runnable skeleton (web, API, reviewer, PostgreSQL, Redis) with lint, typecheck, tests and CI already wired, so that Phase 1 (GitHub integration) has stable ground to build on.

**Delivery phase:** Phase 0 — Foundation. Done when `docker compose up` starts the system and CI runs lint, typecheck and tests.

## What Changes

- Bootstrap a pnpm monorepo with the `AGENTS.md` layout: `apps/web`, `apps/api`, `services/reviewer`, `packages/config`, `infra/`, `docs/`, `tests/`, `.github/workflows/`.
- **Web (`apps/web`)**: React + TypeScript + Vite app with TanStack Query and React Router. One page shows whether the system is up, using the API's readiness endpoint.
- **API (`apps/api`)**: NestJS app with routes under `/api/v1`:
  - `GET /api/v1/health`: is the API process alive.
  - `GET /api/v1/health/ready`: can the API reach PostgreSQL and Redis.
  - OpenAPI docs.
  - Structured JSON logs.
  - Configuration is checked at startup.
  - Prisma is installed with an empty schema (no tables yet).
- **Reviewer (`services/reviewer`)**: Python 3.12 service managed with `uv`, with `GET /health` and `GET /health/ready` (checks Redis). It does no analysis yet.
- **Infra**: `infra/docker-compose.yml` runs PostgreSQL, Redis, API, reviewer and web. Every service has a healthcheck and starts in dependency order.
- **Config**: one root `.env.example` lists every variable with safe local defaults. `.gitignore` keeps `.env` and build output out of git.
- **Quality tooling**:
  - TypeScript: ESLint, Prettier, strict `tsc`, Jest (API) and Vitest (web).
  - Python: Ruff, mypy (strict) and pytest.
  - Root scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- **CI**: a GitHub Actions workflow runs the Node and Python checks on every push and pull request. A separate job starts the compose stack and checks the health endpoints.
- **Docs**: `README.md` (setup and commands), `docs/architecture.md`, `docs/data-model.md` (planned tables, not created yet), `docs/threat-model.md`, and ADR `docs/adr/0001-*` for the stack and tooling choices.

## Non-goals

- GitHub OAuth, the GitHub App, webhooks, BullMQ jobs, or any diff fetching (Phase 1).
- Any database tables or domain migrations. `docs/data-model.md` only describes the plan.
- Deterministic analyzers, LLM calls, or finding schemas (Phase 2).
- Authentication or sessions. Phase 0 endpoints serve no tenant data, so they are public.
- Production deployment, metrics, and dashboards beyond health checks (Phase 3).
- `packages/contracts` and generated API clients. They come in Phase 1, when the first real wire contracts exist.

## Capabilities

### New Capabilities

- `service-health`: Liveness and readiness endpoints for the API and reviewer, dependency checks for PostgreSQL and Redis, error responses that don't leak secrets, and the web status page that shows the result.
- `runtime-configuration`: Every service checks its environment configuration at startup, stops with a clear error if a variable is missing or invalid, never prints secret values, and documents every variable in `.env.example`.
- `local-environment`: One Docker Compose command starts the whole system with healthchecks and dependency ordering. Data services listen only on localhost.
- `ci-quality-gates`: Lint, typecheck, test and build checks for the TypeScript and Python code run locally through root scripts and in CI, and fail the build on any error.

### Modified Capabilities

None. There are no existing specs.

## Impact

- **New code**: `apps/web`, `apps/api`, `services/reviewer`, `packages/config`, `infra/`, `.github/workflows/ci.yml`, root workspace and tooling config.
- **APIs**: `GET /api/v1/health`, `GET /api/v1/health/ready`, OpenAPI docs at `/api/docs`, and reviewer `GET /health` and `GET /health/ready`. None of these are tenant-sensitive.
- **Dependencies (new)**:
  - Node: NestJS, Prisma, ioredis, zod, React, Vite, TanStack Query, React Router, ESLint, Prettier, Jest, Vitest.
  - Python: FastAPI, uvicorn, pydantic-settings, redis, pytest, Ruff, mypy.
  - Containers: postgres, redis, node, python, nginx.
  - Every dependency is pinned in a lockfile (`pnpm-lock.yaml`, `uv.lock`).
- **Systems**: needs Docker Desktop running locally for the compose step, and GitHub Actions for CI. No external services or secrets are needed.
- **Repo hygiene**: initialises git if it isn't already. No commits are made unless asked.
