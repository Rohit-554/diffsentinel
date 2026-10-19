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
