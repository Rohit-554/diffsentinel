# Tasks

## 1. Repository and workspace setup

- [x] 1.1 Run `git init`; add `.gitignore` (`.env`, `node_modules`, `dist`, `.venv`, coverage, caches), `.gitattributes` (`* text=auto eol=lf`) and `.dockerignore`. Verify: `git check-ignore .env` prints `.env`.
- [x] 1.2 Create the root `package.json` (`packageManager: pnpm@9.15.9`, Node >=22, scripts `lint`/`format`/`typecheck`/`test`/`build`/`dev`), `pnpm-workspace.yaml` (`apps/*`, `packages/*`) and `.nvmrc`. Verify: `pnpm install` succeeds and writes `pnpm-lock.yaml`.
- [x] 1.3 Create `packages/config` with `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`). Verify: the file is valid JSON and is listed as a workspace package by `pnpm ls -r --depth -1`.
- [x] 1.4 Add the root ESLint flat config (`typescript-eslint` type-checked with `projectService`, react-hooks scoped to `apps/web`) plus Prettier config and ignore files, as dev dependencies. Verify: `pnpm exec eslint --version` and `pnpm exec prettier --version` run.
- [x] 1.5 Create the root `.env.example` with the Compose Postgres variables, commented, using local defaults. Start `README.md` with the project summary, prerequisites (Node 22, pnpm 9, uv, Docker) and install steps. Verify: `prettier --check README.md` passes.

## 2. API configuration and infrastructure clients

- [x] 2.1 Scaffold `apps/api` (`@diffsentinel/api`): `package.json`, `tsconfig.json`/`tsconfig.build.json` extending the base config (CommonJS via `module: nodenext`, decorators enabled), `nest-cli.json`, Jest + ts-jest config, and dependencies (NestJS 11, `@nestjs/swagger`, zod, ioredis 5, Prisma 6; see design D5 for the version pins). Verify: `pnpm --filter @diffsentinel/api typecheck` runs on an empty `main.ts`.
- [x] 2.2 Implement the zod environment schema and `parseEnv` (`DATABASE_URL`, `REDIS_URL` required; `API_PORT`, `LOG_LEVEL`, `NODE_ENV` defaulted). Error messages list variable names and issues only. Write unit tests for: missing variable, malformed URL, port 70000, a malformed secret-bearing value not appearing in the error, and defaults applied. Verify: `pnpm --filter @diffsentinel/api test` passes.
- [x] 2.3 Add a Prisma schema with a PostgreSQL datasource and generator only (no models), using the Prisma 6 built-in engine and the default CommonJS client. Add a `prisma:generate` script. Verify: `pnpm --filter @diffsentinel/api prisma:generate` succeeds.
- [x] 2.4 Implement `PrismaService` and `RedisService` with `ping()` and shutdown hooks; Redis uses `enableOfflineQueue: false` and an `error` listener that logs codes only. Verify: unit tests with mocked clients cover a successful ping and the error listener not logging the URL.
- [x] 2.5 Add the API variables to `.env.example` with comments. Verify: every key read by the zod schema appears in `.env.example` (unit test or script compares the two).

## 3. API health endpoints

- [x] 3.1 Implement `HealthService`: liveness returns a fixed body; readiness pings all dependencies at once with a 2-second timeout each and maps results to `up`/`down` with the fixed categories `timeout`/`unreachable`. Verify: unit tests cover all-up, postgres-down, redis-down, a hung dependency reported `down` within the timeout, and an error message containing a URL never appearing in the result.
- [x] 3.2 Implement `HealthController` under `/api/v1/health` and `/api/v1/health/ready` (503 when any check is down), plus `main.ts` with the global `api` prefix, URI versioning (default `1`), JSON `ConsoleLogger`, Swagger at `/api/docs`, shutdown hooks, and config parsing before listen. Verify: supertest e2e tests with stubbed services assert 200 liveness while dependencies are down, 200 readiness when all up, and 503 when one is down.
- [x] 3.3 Verify startup behaviour by hand: run `pnpm --filter @diffsentinel/api build`, then `node dist/main.js` without `DATABASE_URL` and confirm a non-zero exit and that no port is opened. Document `pnpm --filter @diffsentinel/api dev` and the endpoints in `README.md`.

## 4. Reviewer service (Python)

- [x] 4.1 Scaffold `services/reviewer` with `uv`: `pyproject.toml` (`requires-python >=3.12,<3.13`, hatchling, `src/reviewer` package), `.python-version` 3.12, runtime dependencies (fastapi, uvicorn, pydantic-settings, redis) and a dev group (pytest, httpx, ruff, mypy), with Ruff and strict mypy config. Verify: `uv sync` installs Python 3.12 and writes `uv.lock`.
- [x] 4.2 Implement `Settings` (pydantic-settings: `REDIS_URL` required and must be `redis://` or `rediss://`, `REVIEWER_PORT` default 8000, `LOG_LEVEL` default `info`) and a JSON log formatter. Tests cover missing `REDIS_URL`, an invalid scheme, and the value not appearing in the error output. Verify: `uv run pytest` passes.
- [x] 4.3 Implement `create_app(settings, redis_factory)` with a lifespan-managed `redis.asyncio` client, `GET /health` and `GET /health/ready` (2-second timeout, same body shape and error categories as the API), and an entry point that parses settings before starting uvicorn. Tests with a fake Redis cover up, down, hung, and liveness without Redis. Verify: `uv run pytest`, `uv run ruff check`, `uv run ruff format --check` and `uv run mypy` pass.
- [x] 4.4 Add the reviewer variables to `.env.example` and a reviewer section in `README.md` (`uv sync`, run, test). Verify: the documented run command starts the service and `GET /health` returns 200.

## 5. Web application

- [x] 5.1 Scaffold `apps/web` (`@diffsentinel/web`): Vite + React + TypeScript extending the base config, TanStack Query, React Router, Vitest + Testing Library + jsdom, and a Vite dev proxy for `/api` to `VITE_API_PROXY_TARGET` (default `http://localhost:3000`). Verify: `pnpm --filter @diffsentinel/web build` succeeds.
- [x] 5.2 Implement the readiness fetch helper (200 and 503 bodies both count as data; a network error or invalid JSON means "API unavailable") and the `SystemStatus` view on route `/`, with text status per dependency and accessible markup. Verify: Vitest tests cover operational, degraded (`redis` down) and API-unreachable states.
- [x] 5.3 Add `VITE_API_PROXY_TARGET` to `.env.example` and document `pnpm --filter @diffsentinel/web dev` in `README.md`. Verify: with the API running on the host, the dev server at `http://localhost:5173` shows the status view.

## 6. Containers and Docker Compose

- [x] 6.1 Write `apps/api/Dockerfile` (multi-stage: pnpm via npm, frozen filtered install, `prisma generate`, `nest build`, `pnpm deploy --prod`, runtime as `node` user). Verify: `docker build -f apps/api/Dockerfile .` succeeds.
- [x] 6.2 Write `services/reviewer/Dockerfile` (`python:3.12-slim`, pinned `uv` binary, `uv sync --frozen --no-dev`, non-root user). Verify: `docker build -f services/reviewer/Dockerfile .` succeeds.
- [x] 6.3 Write `apps/web/Dockerfile` and `apps/web/nginx.conf` (build stage, then `nginx-unprivileged` on 8080 with SPA fallback and `/api/` proxied to `api:3000`). Verify: `docker build -f apps/web/Dockerfile .` succeeds.
- [x] 6.4 Write `infra/docker-compose.yml`:
  - postgres (17-alpine, named volume, `pg_isready`) and redis (7.4-alpine, `redis-cli ping`), with ports bound to `127.0.0.1`;
  - api, reviewer and web, each with a liveness-based healthcheck and `depends_on: service_healthy`;
  - `${VAR:-default}` substitution throughout.

  Verify: `docker compose -f infra/docker-compose.yml config` succeeds without a `.env` file.
- [ ] 6.5 Start Docker Desktop and run `docker compose -f infra/docker-compose.yml up -d --build --wait`. Verify:
  - all services are healthy;
  - `curl localhost:3000/api/v1/health/ready` returns 200 with both dependencies up;
  - `curl localhost:8000/health/ready` returns 200;
  - `http://localhost:8080` shows "operational";
  - `docker compose ps` shows Postgres and Redis on `127.0.0.1`.

  If Docker can't start, record this task as not run and say why.
- [ ] 6.6 Check that data persists and can be reset: create a scratch table with `psql`, run `down` then `up` and confirm it still exists, then run `down -v` then `up` and confirm it is gone. Document compose usage (`up`, `--env-file .env`, `down -v`) in `README.md`.

## 7. Continuous integration

- [ ] 7.1 Write `.github/workflows/ci.yml` with `permissions: contents: read`, triggers on `push` and `pull_request`, and three jobs:
  - **node:** frozen install, `prisma generate`, lint, typecheck, test, build.
  - **python:** `uv sync --frozen`, ruff check and format check, mypy, pytest.
  - **compose-smoke:** needs both; `up --wait`, curl both readiness endpoints, print logs on failure.

  Verify: the workflow YAML parses and every command in it has been run locally in the earlier groups.
- [ ] 7.2 Add a CI badge placeholder and a "Quality gates" section to `README.md` that lists the commands CI runs. Verify: the listed commands match the workflow steps exactly.

## 8. Foundational documentation

- [ ] 8.1 Write `docs/architecture.md`: the component diagram from `AGENTS.md` Ã‚Â§5 marked with what exists in Phase 0, process boundaries, health semantics, and the same-origin `/api` routing in dev and compose. Verify: every component and port named matches `infra/docker-compose.yml`.
- [ ] 8.2 Write `docs/data-model.md`: the planned tables from `AGENTS.md` Ã‚Â§6 with keys, the review idempotency unique constraint, the usersÃ¢â€ â€installations many-to-many, and a note that no tables exist until Phase 1. Verify: it covers all seven planned tables.
- [ ] 8.3 Write `docs/threat-model.md`: assets, trust boundaries (GitHub, browser, API, worker, LLM provider), STRIDE threats per boundary mapped to the `AGENTS.md` Ã‚Â§9 controls, and which controls exist in Phase 0. Verify: every one of the 10 security rules is mapped to at least one threat.
- [ ] 8.4 Write `docs/adr/0001-phase-0-stack-and-tooling.md` recording decisions D1Ã¢â‚¬â€œD11 with their alternatives. Verify: `pnpm exec prettier --check docs` passes.

## 9. Final verification

- [ ] 9.1 From the repo root run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. Verify: all exit 0; record the actual output summary.
- [ ] 9.2 In `services/reviewer` run `uv sync --frozen`, `uv run ruff check`, `uv run ruff format --check`, `uv run mypy` and `uv run pytest`. Verify: all exit 0; record the actual output summary.
- [ ] 9.3 Re-run the full compose smoke check from 6.5 on the final tree. Verify: all services healthy and both readiness endpoints return 200, or record exactly what could not be run and why.
- [ ] 9.4 Run `git status` and confirm no `.env`, secrets, `node_modules`, `dist` or `.venv` would be committed, and that `openspec validate phase-0-foundation --strict` passes.
