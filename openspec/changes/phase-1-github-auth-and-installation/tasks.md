# Tasks

## 1. Configuration

- [x] 1.1 Extend the API zod env schema with `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `PUBLIC_BASE_URL` (all-or-none; must be an http(s) origin with no path) and `SESSION_TTL_HOURS` (1–24, default 8), exposing `config.github: GitHubConfig | null`. Verify: unit tests cover none set (disabled), all set, partial set (error names the missing variables, no values) and a URL with a path; `.env.example` gains the variables (empty, commented) and its coverage test passes.
- [x] 1.2 Pass the new variables through `infra/docker-compose.yml` as `${VAR:-}`. Verify: `docker compose config` succeeds with no `.env` and the stack still starts with sign-in disabled.

## 2. Database schema and migrations

- [x] 2.1 Add Prisma models for `users`, `installations`, `installation_members`, `repositories`, `repository_access`, `sessions` and `audit_events` per design D7 (snake_case mapping, UUID ids, unique and foreign-key constraints, cascades, indexes), then generate the first migration with `prisma migrate dev`. Verify: the migration applies to an empty database and `prisma migrate diff` reports no drift.
- [x] 2.2 Add a `migrate` stage to `apps/api/Dockerfile` and a one-shot `migrate` service in Compose that `api` depends on (`service_completed_successfully`); add `prisma:migrate:dev` and `prisma:migrate:deploy` scripts. Verify: `docker compose up --build --wait` from an empty volume applies the migration before the API becomes healthy, and the runtime image still has no Prisma CLI.
- [ ] 2.3 Add an `integration` Jest project (`pnpm --filter @diffsentinel/api test:integration`) that runs against `DATABASE_URL`/`REDIS_URL`, resetting the schema per run, with a first test proving every table and unique constraint exists. Add Postgres and Redis service containers and this step to the CI `node` job. Verify: passes locally against the Compose databases, and in CI.

## 3. GitHub client

- [ ] 3.1 Implement `GitHubOAuthClient` (authorize-URL builder, code exchange with PKCE verifier) and `GitHubUserClient` (`GET /user`, `/user/installations`, `/user/installations/{id}/repositories`) over `fetch` with 10 s timeouts, the documented headers, zod response schemas, `per_page=100` pagination with caps, and a `GitHubUnavailableError` that carries only a category and HTTP status. Verify: unit tests with a fake `fetch` cover success, timeout, non-2xx, schema mismatch, pagination stopping at the cap (with a truncated flag), and that no body or token appears in error messages or logs.

## 4. Sessions and sign-in

- [ ] 4.1 Implement cookie helpers (`parseCookies`, session and pending cookie options derived from `PUBLIC_BASE_URL`) and the PKCE/state generator with a constant-time compare. Verify: unit tests for parsing edge cases, `Secure` only on https, and a challenge equal to base64url(SHA-256(verifier)).
- [ ] 4.2 Implement `PendingSignInStore` on Redis (`auth:pending:<sha256(id)>`, 600 s TTL, single-use `GETDEL`). Verify: integration tests show a stored entry is readable once, absent on the second read, and gone after expiry.
- [ ] 4.3 Implement `SessionService` (create with a random 32-byte value storing only its SHA-256, look up by cookie with an expiry check, delete, purge expired) and `SessionGuard` with the `@Authenticated()` decorator (401 with a fixed body). Verify: integration tests for create, lookup, expired session, forged value, and a database containing no raw cookie values.
- [ ] 4.4 Implement `AuditService.record()`, usable inside transactions, which rejects metadata keys that look like secrets (`token`, `code`, `secret`, `session`). Verify: unit test for the rejection; integration test that an event is written in the caller's transaction and rolled back with it.
- [ ] 4.5 Implement `GET /api/v1/auth/github/start` (503 `github_not_configured` when disabled; otherwise create the pending sign-in, set `ds_oauth`, redirect with `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`). Verify: e2e tests assert the redirect query, the cookie attributes, two calls producing different state and challenge, and 503 when disabled.
- [ ] 4.6 Implement installation sync (design D6: bounded read phase with concurrency 4, then one transaction that upserts the user, installations and repositories, replaces this user's memberships and repository access, records truncation flags and the `installations.synced` audit event). Verify: integration tests for first sync, repository selection shrinking, access removed, a suspended installation, two users sharing an installation with different private-repository access, the caps, and a GitHub failure mid-read leaving previous state unchanged.
- [ ] 4.7 Implement `GET /api/v1/auth/github/callback` (`GETDEL` the pending entry, constant-time state check, handle `error=access_denied`, exchange the code, run the sync, create the session, audit `auth.sign_in`/`auth.sign_in_failed`, always clear `ds_oauth`, redirect to `/dashboard` or `/?signin=failed|cancelled|unavailable`), and exclude this route's query string from request logging. Verify: integration tests against a fake GitHub HTTP server for success, state mismatch, missing pending cookie, expired pending entry, replayed callback, access denied, token-exchange timeout and an invalid profile; and a log-capture assertion that no `code`, `state` or token appears.
- [ ] 4.8 Implement `GET /api/v1/me` and `POST /api/v1/auth/logout`, plus the same-origin check for mutating `/api/v1` requests (403 on a foreign `Origin`). Verify: e2e tests for `me` signed in and signed out, sign-out deleting the session (old cookie then gets 401), a cross-site `Origin` getting 403 with the session intact, and `GET` sign-out not being routed.

## 5. Tenant access and installation endpoints

- [ ] 5.1 Implement `TenantScope` (`installationsFor`, `repositoriesFor`, `assertInstallationVisible`) as the only builder of tenant filters (membership present, status not `removed`, `repository_access` for repositories). Verify: integration tests with users X and Y on a shared installation and a private repository visible only to X.
- [ ] 5.2 Implement `GET /api/v1/installations` (account login and type, status, accessible repository count, truncated flag), `GET /api/v1/repositories?installationId=` (zod UUID → 400; a non-member gets the same 404 as an unknown ID) and `GET /api/v1/installations/install-url`, all behind `@Authenticated()` and documented in OpenAPI. Verify: the tenant-access integration suite calls every tenant-scoped endpoint as a member, a non-member and an unauthenticated client, and checks that 404 bodies for "not yours" and "doesn't exist" are byte-identical; plus a test that removing a membership revokes access in an already-open second session.

## 6. Web

- [ ] 6.1 Add a typed API client (`me`, `installations`, `repositories`, `installUrl`, `logout`) with `credentials: "same-origin"` and a shared 401 handler. Verify: Vitest unit tests for success, 401 and network-failure mapping.
- [ ] 6.2 Build the landing route `/`: status panel, a "Sign in with GitHub" link, messages for `?signin=failed|cancelled|unavailable|not_configured` and the sign-in-unavailable state, and a redirect to `/dashboard` when signed in. Verify: Vitest tests for each message and the redirect.
- [ ] 6.3 Build the `/dashboard` route: installations with per-installation repository lists, suspended and truncated badges, an empty state with install instructions, and the "Install on GitHub", "Refresh from GitHub" and "Sign out" actions, redirecting to `/` on 401; all GitHub-provided text rendered as plain text. Verify: Vitest tests for empty, populated, suspended, truncated, a repository name containing HTML (rendered as text), the 401 redirect and the sign-out POST.

## 7. Documentation

- [ ] 7.1 Add a README "GitHub App setup (development)" guide: create the App on the personal account, callback URLs for `:8080` and `:5173`, Setup URL `/api/v1/auth/github/start`, "Request user authorization during installation" off, metadata-only permissions, no webhook yet, and which values go into `.env`. Document the new endpoints. Verify: following the guide step by step produces a working App in 7.4.
- [ ] 7.2 Update `docs/data-model.md` (tables now real; add `repository_access` and `sessions`; PostgreSQL 17 rationale), `docs/architecture.md` (auth flow sequence, sessions, Redis pending sign-ins, migrate service) and `docs/threat-model.md` (T12–T14 implemented; residual stale-access risk). Verify: `pnpm lint` passes and every table named in the docs exists in `schema.prisma`.
- [ ] 7.3 Add `docs/adr/0002-github-sign-in-and-sessions.md` recording D1–D4, D9 and D10 with their alternatives. Verify: links resolve and Prettier passes.

## 8. Verification

- [ ] 8.1 From the repository root run `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @diffsentinel/api test:integration` and `pnpm build`. Verify: all exit 0; record the test counts.
- [ ] 8.2 From an empty volume run `docker compose -f infra/docker-compose.yml up -d --build --wait` without GitHub settings. Verify: all services healthy, readiness 200, `GET /api/v1/auth/github/start` returns 503 `github_not_configured`, and the landing page says sign-in is unavailable.
- [ ] 8.3 Push and confirm the CI workflow (including the new integration step) passes on GitHub.
- [ ] 8.4 Manual end-to-end test with a real dev GitHub App on the personal account (needs the user's App credentials in `.env`): sign in, install on one repository, see it listed, change the selection to two repositories and refresh, sign out, confirm the old cookie gets 401. Verify: record each observed result in this task. If credentials are unavailable, record this task as not run and why.
- [ ] 8.5 Run `openspec validate phase-1-github-auth-and-installation --strict` and `git status`. Verify: the change is valid and no `.env`, secrets or build output are tracked.
