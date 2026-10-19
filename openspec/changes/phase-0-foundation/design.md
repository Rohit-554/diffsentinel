# Design

## Context

The repository is empty apart from `AGENTS.md` and OpenSpec setup. There is no git repository yet, no package manager files, and no code. See `proposal.md` for the motivation and `specs/` for the required behaviour.

Constraints from the local machine, checked on 2026-10-19:
- Node 22.11, pnpm 9.15.9, uv 0.8.3 and Docker 29.8 are installed.
- Python 3.12 is **not** installed locally. Python 3.9–3.11 and 3.13 are. `uv` will download 3.12.
- The Docker daemon was not running. The compose step needs Docker Desktop to be started.
- The OS is Windows. Contributors and CI may use Linux or macOS.

## Goals / Non-Goals

**Goals:**
- Every service builds, starts and answers its health endpoints, both on the host (`pnpm dev`, `uv run`) and in compose.
- Make the right patterns the default for later phases: checked config, structured logs, `/api/v1` versioning, time-limited dependency checks, a strict type checker, and lockfile-only installs.
- Keep the dependency list small. Each library must either be required by `AGENTS.md` or be needed by Phase 1 anyway.

**Non-Goals:**
- No domain tables, auth, queues or jobs. Prisma is installed but its schema has no models.
- No production deployment manifests, TLS, or secrets manager integration.
- No shared contracts package yet (see the proposal's Non-goals).

## Decisions

### D1. pnpm workspaces, no Turborepo or Nx
The root `pnpm-workspace.yaml` lists `apps/*` and `packages/*`. Root scripts call `pnpm -r <script>`. `packageManager` is pinned to `pnpm@9.15.9`, the installed version.
- *Alternatives:* Turborepo or Nx add caching and task graphs, but they are another framework to justify with only two TS packages. npm workspaces handle many dependencies worse. Revisit if CI gets slow.

### D2. Shared TS config in `packages/config`; one ESLint flat config at the root
- `packages/config` holds `tsconfig.base.json`:
  - `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`.
- Apps extend it with a relative path, so Docker builds don't depend on workspace symlinks.
- A single root `eslint.config.mjs` uses `typescript-eslint` type-checked rules, with `projectService` turned on.
  - This catches floating promises, which matters most for async backend code.
  - React hooks rules apply only to `apps/web`.
- Prettier is configured at the root. `pnpm lint` runs `eslint .` and `prettier --check .`.
- *Alternative:* a separate ESLint config per package. That means more duplication and drift; one config is enough at this size.

### D3. NestJS API written by hand, not generated with `nest new`
- The generator creates its own git repo, ESLint and Prettier setup, and sample code, which would conflict with D2.
- The `@nestjs/cli` dev dependency is kept for `nest build` and `nest start --watch`. Nest DI needs `emitDecoratorMetadata`, which `tsc` supports and esbuild-based runners like `tsx` don't.
- Modules:
  - `ConfigModule`: provides the checked config under an injection token.
  - `InfraModule`: `PrismaService` and `RedisService`, each with a `ping()` method, closed cleanly on shutdown.
  - `HealthModule`: the controller and service.
- Routing:
  - `app.setGlobalPrefix('api')` plus URI versioning with default version `1` gives `/api/v1/...`.
  - The OpenAPI docs are served through `@nestjs/swagger` at `/api/docs` and are not versioned.
- The module is compiled to CommonJS with `module: nodenext` (no `"type": "module"`). This is the most reliable setup for Nest, Jest and decorators.

### D4. Config checking with zod in the API and pydantic-settings in the reviewer
- Each service has a single `parseEnv` / `Settings` entry point that runs before the HTTP server starts.
- On failure, the error lists only variable names and issue messages. It never includes the input values, because zod issues and Pydantic errors are shown without `input`.
- *Alternative:* `@nestjs/config` with Joi. That is more indirection and still needs a schema library, so zod alone is enough.
- Variables:

  | Service | Variable | Default |
  | --- | --- | --- |
  | API | `DATABASE_URL` | required |
  | API | `REDIS_URL` | required |
  | API | `API_PORT` | 3000 |
  | API | `LOG_LEVEL` | `info` |
  | API | `NODE_ENV` | `development` |
  | Reviewer | `REDIS_URL` | required |
  | Reviewer | `REVIEWER_PORT` | 8000 |
  | Reviewer | `LOG_LEVEL` | `info` |
  | Compose only | `POSTGRES_USER` | local default |
  | Compose only | `POSTGRES_PASSWORD` | local default |
  | Compose only | `POSTGRES_DB` | local default |

### D5. Prisma set up now with an empty schema; Redis client is ioredis
- `AGENTS.md` names Prisma for migrations, and Phase 1 adds the first tables. Setting it up now means the migrate workflow, the `generate` step in CI and Docker, and the Postgres connection are proven early.
- The readiness check runs `SELECT 1` through the Prisma client.
- Use the current Prisma major version and follow its setup at apply time:
  - the PostgreSQL driver adapter;
  - the generated client output path;
  - CommonJS output, to fit D3.
- Confirm these details against the current Prisma docs; don't assume the older defaults.
- Redis uses ioredis because BullMQ (Phase 1) requires it.
  - Settings: `enableOfflineQueue: false` and `maxRetriesPerRequest: 1`, so a ping fails fast instead of queuing.
  - An `error` listener logs the error code only, which prevents unhandled-error crashes and log floods.
- *Alternative:* the plain `pg` driver for health now and Prisma later. That adds a throwaway dependency and leaves migrations unproven until Phase 1.

### D6. Health semantics
- **Liveness:**
  - Returns a fixed `{status:"ok", service, version}`.
  - Makes no I/O calls, so orchestrators never restart a healthy process because a dependency is down.
- **Readiness:**
  - Runs every dependency ping at the same time, each wrapped in a 2-second timeout.
  - Maps each result to `{status:"up"|"down", latencyMs?, error?}`. The `error` field is a fixed category: `timeout` or `unreachable`.
  - Returns 503 via `ServiceUnavailableException` when any dependency is down.
- The real error is logged on the server with its class name and code only, never the message text, which can contain hosts or URLs.
- The response body structure is the same in the API and the reviewer, so the web view and CI parse one format.

### D7. Structured logging with the built-in Nest JSON logger
- Nest 11's `ConsoleLogger` with `json: true` writes structured logs with no extra dependency. The log level comes from config.
- The reviewer uses stdlib `logging` with a small JSON formatter.
- *Alternative:* `nestjs-pino`, which is richer but adds two dependencies before there are request-level fields worth logging. Revisit in Phase 3 (observability).

### D8. Web: Vite + React + TanStack Query + React Router, same origin as the API
- One route (`/`) renders the `SystemStatus` view.
- The fetch helper treats both 200 and 503 readiness responses as valid data, and only a network failure or invalid JSON as "API unavailable". Status is always shown as text and never as colour alone.
- `/api` is same-origin in both modes:
  - **Development:** the Vite dev server proxies `/api` to `VITE_API_PROXY_TARGET`, default `http://localhost:3000`.
  - **Compose:** nginx proxies `/api/` to `api:3000`.
  - This avoids CORS configuration and means Phase 1 session cookies can be same-site.
- Tests use Vitest, Testing Library and jsdom.
- *Why Jest for the API but Vitest for web:* Vitest relies on esbuild, which does not emit decorator metadata. Making it work for Nest needs an SWC plugin. Jest with `ts-jest` works with Nest as is, and Vitest is the natural fit for Vite.

### D9. Reviewer as a small FastAPI process
- `AGENTS.md` prefers a queue-driven worker, and HTTP only if necessary. An HTTP health server is necessary now, for the compose healthcheck and CI smoke tests.
- Phase 1 adds the queue consumer in the same process: a background task started from the FastAPI lifespan.
- Layout:
  - The package lives in `src/reviewer/` and is managed by `uv`, with `requires-python = ">=3.12,<3.13"` and `.python-version` set to 3.12.
  - The app is built through `create_app(settings, redis_factory)`, so tests can pass in a fake Redis.
  - The Redis client is `redis.asyncio`.
- Tooling: Ruff for lint and format, mypy `--strict`, and pytest with httpx's `TestClient`.

### D10. Containers and compose
- **Images:** pinned to major.minor tags.
  - `postgres:17-alpine`, `redis:7.4-alpine`, `node:22-alpine`, `python:3.12-slim`.
  - `nginxinc/nginx-unprivileged:1.27-alpine`, which runs as non-root on port 8080.
- **API image:**
  - Multi-stage build. It installs pnpm globally from npm instead of using corepack, which avoids corepack signature-key issues on older images.
  - Runs `pnpm install --frozen-lockfile --filter @diffsentinel/api...`, then `prisma generate` and `nest build`, then `pnpm deploy --prod`.
  - The runtime stage runs as the `node` user.
- **Reviewer image:**
  - Copies `uv` from its official image at a pinned tag and runs `uv sync --frozen --no-dev`.
  - Runs as a non-root user.
- **Build context:** the repository root, with a root `.dockerignore` that excludes `node_modules`, `dist`, `.venv` and `.env*`.
- **Startup and health:**
  - Compose uses `depends_on: condition: service_healthy` (spec: dependency ordering).
  - Healthchecks for app containers call their liveness endpoints with the runtime's own tools (`node -e fetch`, `python -c urllib`, `wget` in nginx). No curl is installed.
- **Ports and env:**
  - Postgres and Redis publish on `127.0.0.1` only.
  - Compose variables use `${VAR:-default}`, so the stack runs without a `.env` file.
- Compose is run from the repo root with `-f infra/docker-compose.yml`. The README documents `--env-file .env` for overrides.

### D11. CI: one workflow, three jobs
`.github/workflows/ci.yml` runs on `push` and `pull_request`:
1. **node**
   - Sets up pnpm and Node 22 with the pnpm cache.
   - Runs `pnpm install --frozen-lockfile`, `prisma generate`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
2. **python**
   - Sets up uv.
   - Runs `uv sync --frozen`, `ruff check`, `ruff format --check`, `mypy` and `pytest`.
3. **compose-smoke**
   - Needs both jobs above.
   - Runs `docker compose up -d --build --wait --wait-timeout 180`, then curls the API and reviewer readiness endpoints.
   - Always prints `docker compose logs` on failure.

The workflow sets `permissions: contents: read` and uses no secrets.

### D12. Repository hygiene
- Run `git init`. No commits are made unless the user asks.
- `.gitattributes` sets `* text=auto eol=lf`, so shell scripts and the nginx config keep LF line endings when checked out on Windows.
- `.gitignore` covers `.env`, `node_modules`, `dist`, `.venv`, coverage and caches.

## Affected contracts, data, queue and tenant boundaries

- **API contracts:**
  - New: `GET /api/v1/health`, `GET /api/v1/health/ready`, and the OpenAPI document at `/api/docs`.
  - Reviewer: `GET /health` and `GET /health/ready`.
  - All return the shared health body shape from D6.
- **Database:** no tables or migrations. Prisma has a datasource and a generator only. `docs/data-model.md` describes the planned tables for Phase 1.
- **Queue:** none. Redis is only pinged. No BullMQ queues or keys are created.
- **Tenant boundaries:** none crossed. The health endpoints expose no tenant data, so they are public by design. Every tenant-scoped route added later must check authorization (see `docs/threat-model.md`).

## Security considerations

Phase 0 touches these `AGENTS.md` §9 rules:
- **Rule 2 (no secrets in logs):**
  - Config errors print variable names only (D4).
  - Health errors expose fixed categories, and server logs record the error class and code, not messages (D6).
  - The ioredis error listener logs codes only (D5).
- **Rule 3 (secrets at rest):**
  - Only local throwaway credentials exist, as compose defaults and in `.env.example`.
  - `.env` is git-ignored and Docker-ignored.
  - CI uses no secrets (D11).
- **Rule 5 (no untrusted code execution):** not applicable yet. Containers still run as non-root (D10) to set the pattern.
- **Rule 7 (hard limits):**
  - Dependency checks are time-limited (D6).
  - The NestJS body parser keeps its default size limit, to be tightened when the webhook route arrives.
- **Rule 8 (input validation):** config input is validated (D4). No user input is accepted yet.
- **Network exposure:** data stores bind to loopback only. The API is reachable through nginx in compose; the readiness endpoint reveals dependency up/down state, which is acceptable for local and CI use.
- **Supply chain:** every dependency is pinned by a lockfile, CI installs from the lockfile only, and container images use pinned tags.
- **Threat model:** `docs/threat-model.md` starts the STRIDE threat model for the full planned system, so the Phase 1 webhook and auth work begins from documented threats.

## Risks / Trade-offs

- [Docker Desktop not running locally, so the compose step can't be checked on this machine] → Start Docker Desktop before the compose task. If that isn't possible, record the compose check as not run and rely on the CI smoke job.
- [The current Prisma major may need a driver adapter, an explicit client output path, or config-file changes that differ from older guides] → Follow current Prisma docs at apply time and prove it with the readiness test against a real Postgres in compose.
- [The type-checked ESLint `projectService` can be slow and must cover config files such as `vite.config.ts` and `eslint.config.mjs`] → Use `allowDefaultProject` for root config files. Acceptable at this repo size.
- [CRLF line endings on Windows breaking shell scripts in Linux containers] → `.gitattributes` with `eol=lf` (D12).
- [Readiness is public and reveals dependency state] → Acceptable for Phase 0. Revisit in Phase 3: limit it to an internal network or require auth for detailed output.
- [Two TS test runners (Jest and Vitest)] → Small cost for avoiding decorator-metadata workarounds. Both are run through the same `pnpm test` script.
- [pnpm 9 is pinned while newer majors exist] → Matches the installed toolchain and the `pnpm deploy` behaviour in D10. Upgrading is a separate, small change.

## Migration Plan

There is nothing to migrate in a greenfield repo. Rolling back means deleting the scaffolded directories. No databases or external systems are changed.

## Open Questions

- Postgres 17 vs 18 for the base image. Both work for Phase 0. Pick before the first real migration in Phase 1.
