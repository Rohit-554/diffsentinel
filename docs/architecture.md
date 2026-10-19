# Architecture

DiffSentinel reviews GitHub pull requests: a GitHub App sends signed webhooks, the API records a review job and queues it, and a Python worker analyses the diff and stores findings for the dashboard. This document describes the target design and marks what exists today.

**Current phase:** Phase 0 (foundation). Only the components marked _Phase 0_ below exist.

## Components

```text
GitHub OAuth sign-in ──> Web ──> NestJS API ──> PostgreSQL
                                     │
GitHub App ──signed webhook─────────>│
                                     ├── verify + persist delivery/job
                                     └── enqueue in BullMQ / Redis
                                                  │
                                     Python reviewer worker
                                                  │
                            Fetch changed files using installation token
                                                  │
                     deterministic checks → LLM → validate findings
                                                  │
                           persist findings + cost + completion state
                                                  │
                      dashboard results / optional GitHub Checks API
```

| Component  | Path                | Technology                                   | Phase 0 status                                             |
| ---------- | ------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| Web        | `apps/web`          | React, Vite, TanStack Query, React Router    | Exists: system status page                                 |
| API        | `apps/api`          | NestJS 11, Prisma 6, ioredis 5               | Exists: health endpoints, OpenAPI docs, config validation  |
| Reviewer   | `services/reviewer` | Python 3.12, FastAPI, redis-py               | Exists: health endpoints only                              |
| PostgreSQL | `infra`             | `postgres:17-alpine`                         | Exists: no tables yet (see [data-model.md](data-model.md)) |
| Redis      | `infra`             | `redis:7.4-alpine`                           | Exists: pinged only; no queues yet                         |
| GitHub App | —                   | GitHub REST API, webhooks, installation auth | Phase 1                                                    |
| LLM stage  | `services/reviewer` | Provider-abstracted model API                | Phase 2                                                    |

## Process boundaries

- **The API owns user access and durable job records.** Every tenant-sensitive check (who may see which installation, repository, review or finding) happens in the API. It is the only component that receives webhooks and writes review jobs.
- **The reviewer owns analysis.** It will consume jobs from the queue, fetch PR changes with a short-lived installation token, run the analyzers, and report results. It never serves user-facing requests.
- **The browser talks only to its own origin.** The web app calls `/api/...` on the same origin it was loaded from, so no CORS policy is needed and later session cookies can be same-site.
- **Shared wire contracts, not shared code.** Python and TypeScript share versioned contracts and test fixtures, never domain logic.

## Runtime topology

### Docker Compose (`infra/docker-compose.yml`)

```text
browser ──> web (nginx, :8080) ──/api/──> api (:3000) ──> postgres (:5432)
                                               └────────> redis (:6379) <── reviewer (:8000)
```

| Service  | Container port | Host port (127.0.0.1 only)  | Starts after            | Healthcheck          |
| -------- | -------------- | --------------------------- | ----------------------- | -------------------- |
| postgres | 5432           | 5433 (`POSTGRES_HOST_PORT`) | —                       | `pg_isready`         |
| redis    | 6379           | 6379 (`REDIS_HOST_PORT`)    | —                       | `redis-cli ping`     |
| api      | 3000           | 3000                        | postgres, redis healthy | `GET /api/v1/health` |
| reviewer | 8000           | 8000                        | redis healthy           | `GET /health`        |
| web      | 8080           | 8080                        | api healthy             | `GET /` (nginx)      |

nginx serves the built web app and proxies `/api/` to `api:3000`. Every application container runs as a non-root user. PostgreSQL data lives in the `pgdata` named volume.

### Local development (host)

The Vite dev server (`:5173`) proxies `/api` to `VITE_API_PROXY_TARGET` (default `http://localhost:3000`), the same origin model as nginx in Compose. The API and reviewer read the repository-root `.env` when run on the host. Variables already set in the environment take precedence.

## Health semantics

Both services expose the same two kinds of endpoint, with the same response shape:

- **Liveness** (`GET /api/v1/health`, reviewer `GET /health`) makes no I/O calls and returns `200 {"status":"ok", "service", "version"}` whenever the process can serve requests. A dependency outage never makes a service look dead, so orchestrators don't restart healthy processes.
- **Readiness** (`GET /api/v1/health/ready`, reviewer `GET /health/ready`) checks each dependency concurrently with a 2-second timeout each. It returns `200` with `"status":"ok"` when all are up, otherwise `503` with `"status":"unavailable"`. Each dependency is reported as `{"status":"up"|"down", "latencyMs", "error"?}`, where `error` is a fixed category (`timeout` or `unreachable`). Raw driver errors are never returned, and logs record only the error class and code, because driver messages can contain hosts or credentials.

| Service  | Readiness depends on |
| -------- | -------------------- |
| api      | PostgreSQL, Redis    |
| reviewer | Redis                |

## Configuration

Each service validates its environment at startup and exits non-zero before opening its port if a variable is missing or invalid. Error messages name the variable but never its value. All variables are listed in the root [`.env.example`](../.env.example). Tests check that the file covers every variable each service reads.

## Observability (Phase 0)

All services log one JSON object per line to stdout. NestJS uses its built-in JSON `ConsoleLogger`; the reviewer uses a small `logging` formatter that reduces exceptions to their type name. Metrics and tracing arrive in Phase 3.

## Key decisions

See [ADR 0001](adr/0001-phase-0-stack-and-tooling.md) for the stack and tooling choices behind this layout, and [threat-model.md](threat-model.md) for security boundaries.
