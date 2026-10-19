# DiffSentinel

DiffSentinel is a GitHub-connected code-review platform. It reviews pull requests, explains actionable findings with file and line evidence, and (in a later phase) proposes fixes as separate draft pull requests that a person must approve.

**Status:** Phase 0 (foundation). The services start, report their health, and pass lint, typecheck and tests. GitHub integration and code review are not built yet. See [`AGENTS.md`](AGENTS.md) for the full product plan.

## Repository layout

| Path                | What it is                                                 |
| ------------------- | ---------------------------------------------------------- |
| `apps/web`          | React + TypeScript + Vite dashboard                        |
| `apps/api`          | NestJS API (`/api/v1`), later GitHub webhooks and auth     |
| `services/reviewer` | Python 3.12 reviewer service, later the analysis worker    |
| `packages/config`   | Shared TypeScript configuration                            |
| `infra`             | Docker Compose for the full local stack                    |
| `docs`              | Architecture, data model, threat model and decision record |
| `openspec`          | OpenSpec change proposals and specs                        |

## Prerequisites

- Node.js 22 (see `.nvmrc`)
- pnpm 9 (`npm install -g pnpm@9`)
- [uv](https://docs.astral.sh/uv/) for the Python service (it installs Python 3.12 for you)
- Docker Desktop (or Docker Engine with Compose v2) for the full stack

## Install

```bash
pnpm install
cp .env.example .env   # optional: only needed to override defaults
```

## API (`apps/api`)

The API reads its settings from environment variables (see `.env.example`). It stops at startup, before opening its port, if `DATABASE_URL` or `REDIS_URL` is missing or invalid. Error messages name the variable but never print its value.

```bash
pnpm --filter @diffsentinel/api prisma:generate   # once after install
pnpm --filter @diffsentinel/api dev               # watch mode on http://localhost:3000
pnpm --filter @diffsentinel/api test
```

When run directly on the host, the API needs PostgreSQL and Redis reachable at the URLs in your environment, for example from the Docker Compose stack below. Without them, the API still starts, but readiness reports `503`.

| Endpoint                   | Purpose                                                                           |
| -------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/v1/health`       | Liveness. `200` whenever the process is running; makes no dependency calls.       |
| `GET /api/v1/health/ready` | Readiness. `200` if PostgreSQL and Redis both answer within 2 s, otherwise `503`. |
| `GET /api/docs`            | OpenAPI (Swagger) UI. The raw document is at `/api/docs-json`.                    |
