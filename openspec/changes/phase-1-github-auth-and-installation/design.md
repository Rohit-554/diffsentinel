# Design

## Context

Phase 0 is merged. There is a NestJS 11 API with health endpoints, zod config and Prisma 6 (empty schema); a reviewer (health only); a React/Vite web app (status page); a Compose stack; and CI. There are no tables, no auth and no GitHub calls yet. See `proposal.md` for scope and `specs/` for required behaviour.

Facts checked against GitHub's docs on 2026-10-19:
- GitHub Apps authorize users through `https://github.com/login/oauth/authorize` and `POST https://github.com/login/oauth/access_token`, with `state` and PKCE (`S256` only).
- User access tokens last 8 hours.
- `GET /user/installations` and `GET /user/installations/{id}/repositories` (max `per_page=100`) list only what both the App and the user can access.
- The App option "Request user authorization (OAuth) during installation" sends the user back with only `client_id`, so no `state` and no PKCE. It therefore can't satisfy the sign-in spec.

## Goals / Non-Goals

**Goals:**
- A secure sign-in and session foundation that later slices reuse unchanged.
- A single authorization policy for tenant-scoped data, tested against a real PostgreSQL.
- Developers can run everything without GitHub credentials, and opt in to real GitHub with a dev App.

**Non-Goals:**
- Webhooks, the App private key, installation tokens and anything that reads code (slices 2–3).
- Storing or refreshing GitHub user tokens.
- Background membership re-verification. Until slice 2's installation webhooks, access is re-verified at each sign-in or refresh, with stale access limited by the 8-hour session lifetime.

## Decisions

### D1. One GitHub App for both sign-in and installation; installation-time OAuth turned off
- Sign-in uses the App's user authorization flow, so there is one registration, one client ID, and permissions shown in one place.
- The App's Setup URL is `${PUBLIC_BASE_URL}/api/v1/auth/github/start`. After installing, the user goes through our own flow with `state` and PKCE, and the callback syncs installations.
- The setting "Request user authorization during installation" stays **off** because it skips `state` and PKCE.
- Callback URLs registered on the App:
  - `${PUBLIC_BASE_URL}/api/v1/auth/github/callback`
  - For development: `http://localhost:8080/...` (Compose) and `http://localhost:5173/...` (Vite).
- *Alternative:* a separate OAuth App for sign-in. That means two registrations and two secrets, and GitHub recommends Apps.

### D2. Pending sign-ins are stored in Redis, single-use
`/auth/github/start` does the following:
1. Generates a random `state`, a PKCE verifier (32 random bytes, base64url) and a random pending ID.
2. Stores `{state, verifier}` in Redis under `auth:pending:<sha256(pendingId)>` with a 600 s TTL.
3. Sets the cookie `ds_oauth=<pendingId>` (HttpOnly, SameSite=Lax, Path=`/api/v1/auth/github`, Max-Age 600).

The callback reads the pending entry with `GETDEL`, so it can only be used once, even by a replayed callback. It compares the `state` values in constant time and always clears the cookie.
- *Alternatives:*
  - An HMAC-signed cookie needs another secret, and can't enforce single use.
  - A Postgres table works but needs a cleanup job.
  - Redis is already a dependency, and its TTLs expire entries for free.
- *Failure mode:* if Redis is down, sign-in fails with "GitHub is unavailable / try again", which is acceptable.

### D3. Sessions in PostgreSQL, opaque cookie
- The `ds_session` cookie holds 32 random bytes in base64url.
  - Flags: `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` when `PUBLIC_BASE_URL` is https.
  - `Max-Age` equals `SESSION_TTL_HOURS` (default 8, range 1–24).
- The database stores only `sha256(value)` in `sessions.token_hash`, which is unique. Looking a session up means hashing the cookie value and finding a row whose `expires_at > now()`. A leaked database therefore gives an attacker no usable cookies.
- Expired rows are deleted when they're encountered, and also in a bulk purge at each sign-in.
- Sign-out deletes the row. There is no sliding expiry in this slice.
- *Alternative:* JWTs. They can't be revoked without a deny-list, and they leak claims.

### D4. GitHub user tokens are used only inside the callback
- The callback exchanges the code, then calls `GET /user`, `GET /user/installations` and `GET /user/installations/{id}/repositories` with the token, all in memory.
- The token is never persisted, logged or returned.
- "Refresh from GitHub" in the UI is just a link to `/auth/github/start`. GitHub skips the consent screen for an already-authorized App, so this is a quick round-trip.
- Consequence: no token storage or encryption is needed now (matching AGENTS.md: short-lived tokens in memory only).

### D5. Small GitHub client over `fetch`, validated with zod; no Octokit
`GitHubOAuthClient` (token exchange) and `GitHubUserClient` (user-scoped REST calls) behave as follows:
- Every request has `AbortSignal.timeout(10_000)` and the headers `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` and `User-Agent: DiffSentinel`.
- Responses are parsed with zod schemas. Any schema mismatch, non-2xx status or timeout becomes a `GitHubUnavailableError`, which records the category and HTTP status only, never the body.
- Pagination uses `per_page=100` with a page cap derived from the sync limits.

Both clients sit behind interfaces, so tests inject fakes.
- *Alternative:* Octokit. It's a heavy dependency set for five endpoints, and slice 3 can revisit it for installation tokens.

### D6. Sync: read everything first, then write in one transaction
1. **Read (GitHub, outside the DB transaction):**
   - The user profile.
   - Installations: at most 20 (one page).
   - For each installation, the user's accessible repositories: at most 3 pages of 100, read 4 installations at a time.
   - Worst case: 1 + 20 × 3 = 61 requests.
2. **Write (one Prisma `$transaction`):**
   - Upsert the user.
   - Upsert installations by `github_installation_id`, setting status `active` or `suspended` from `suspended_at`.
   - Upsert repositories by `github_repository_id`.
   - Replace this user's `installation_members` and `repository_access` rows with exactly the read set, keeping `truncated` flags.
   - Insert the `auth.sign_in` and `installations.synced` audit events.
   - Create the session.
3. Any read failure aborts before step 2, so earlier state stays unchanged.
- Another user's rows are never touched, because deletes are always filtered by `user_id`.
- Repository rows are shared and are never deleted by a user's sync. Repositories that nobody can access simply become invisible. Slice 2's `installation_repositories` webhook will remove them properly.

### D7. Data model: first Prisma migration
Six tables from `docs/data-model.md`, plus `repository_access` and `sessions`. This slice creates only what it uses:

| Table                  | Key columns                                                                 | Constraints                                                        |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `users`                | `id` uuid, `github_user_id` bigint, `login`, `display_name`                 | unique `github_user_id`                                            |
| `installations`        | `id`, `github_installation_id` bigint, `account_id`, `account_login`, `account_type`, `status` enum | unique `github_installation_id`                                    |
| `installation_members` | `user_id`, `installation_id`, `verified_at`, `repositories_truncated` bool  | PK (`user_id`,`installation_id`), FKs cascade on delete            |
| `repositories`         | `id`, `github_repository_id` bigint, `installation_id`, `full_name`, `default_branch`, `private` | unique `github_repository_id`; FK installation                     |
| `repository_access`    | `user_id`, `repository_id`, `verified_at`                                   | PK (`user_id`,`repository_id`), FKs cascade on delete              |
| `sessions`             | `id`, `user_id`, `token_hash` bytea, `created_at`, `expires_at`             | unique `token_hash`; index `expires_at`; FK user cascade on delete |
| `audit_events`         | `id`, `actor_user_id` nullable, `action`, `resource_type`, `resource_id`, `metadata` jsonb, `occurred_at` | index (`actor_user_id`, `occurred_at`)                             |

- The `installations.status` enum is `active | suspended | removed`. `removed` is set by slice 2 webhooks, and the policy already excludes it.
- Column names are snake_case through Prisma `@map`, with ids from `gen_random_uuid()`.
- **PostgreSQL stays on 17** (this resolves the Phase 0 open question). The `postgres:18` image changed its data-volume layout (`PGDATA` moved under `/var/lib/postgresql/18`), which would mean changing the Compose volume and migrating local data, with no benefit for this slice.

### D8. Migrations in Compose and development
- `apps/api/Dockerfile` gains a `migrate` stage, built from the build stage, which has the Prisma CLI. Its command is `prisma migrate deploy`.
- Compose adds a one-shot `migrate` service (`restart: "no"`). `api` depends on it with `condition: service_completed_successfully`.
- The production runtime image still has no Prisma CLI.
- Development: `pnpm --filter @diffsentinel/api prisma:migrate:dev` against the Compose database. The `prisma/migrations/` directory is committed.
- *Alternative:* running migrations on API startup. That races when there are multiple replicas and mixes concerns.

### D9. Authorization: guard + one tenant-scope service
- **`SessionGuard`** (applied with an `@Authenticated()` decorator) resolves `ds_session` to a user. On failure it returns `401` with a fixed body. On success it attaches `{ userId }` to the request.
- **`TenantScope`** is the only place that builds tenant filters:
  - `installationsFor(userId)`: membership exists and status ≠ `removed`.
  - `repositoriesFor(userId, { installationId? })`: `repository_access` row for the user **and** membership in the repository's installation **and** status ≠ `removed`.
  - `assertInstallationVisible(userId, installationId)`: throws `NotFoundException` with the same body used for unknown IDs.
- Controllers never call Prisma directly for tenant data.
- IDs in requests are our UUIDs, validated with zod; malformed ones get `400`.
- *Alternative:* PostgreSQL row-level security. It's stronger, but it complicates Prisma connection handling. Revisit in Phase 3 hardening.

### D10. CSRF and cookie handling
- **Same-origin check:** state-changing requests (`POST`/`PATCH`/`DELETE`) under `/api/v1` pass through a check that rejects with `403` when an `Origin` header is present and doesn't equal `new URL(PUBLIC_BASE_URL).origin`.
  - Together with `SameSite=Lax`, this blocks cross-site sign-out and future mutations.
  - The webhook route (slice 2) will be excluded explicitly and use HMAC instead.
- **Cookie parsing:** a small, tested `parseCookies(header)` helper. No `cookie-parser` dependency is needed, and Express's `res.cookie` sets cookies.
- **Types:** add `@types/express` as a dev dependency for request and response typing. It's types only, with no runtime cost.
- **Redirects:** only to fixed internal paths (`/dashboard`, `/?signin=<reason>`). There is no user-controlled `returnTo`, so there's no open redirect.

### D11. Configuration
| Variable | Rule |
| --- | --- |
| `GITHUB_APP_CLIENT_ID` | Must be set together with the next three, or all four left unset |
| `GITHUB_APP_CLIENT_SECRET` | Must be set together with the others |
| `GITHUB_APP_SLUG` | Must be set together with the others |
| `PUBLIC_BASE_URL` | Must be set together with the others; must be an `http(s)` URL without a path |
| `SESSION_TTL_HOURS` | Optional; default 8 |

- Partial GitHub configuration fails at startup, naming the missing variables (spec).
- `config.github` is typed as `GitHubConfig | null`.
- Compose passes these through as `${VAR:-}`, so the stack still starts without them, with sign-in disabled.
- `.env.example` documents them as empty, with setup instructions.

### D12. Web
- **Routes:**
  - `/`: the landing page. It shows the status panel, a "Sign in with GitHub" link to `/api/v1/auth/github/start`, and a message for `?signin=failed|cancelled|unavailable|not_configured`. When `/me` returns 200, it redirects to `/dashboard`.
  - `/dashboard`: requires `/me`, otherwise redirects to `/`. It shows installations, each with its repositories (lazy per installation via `?installationId=`), suspended and truncated badges, an empty state with install instructions, and the actions "Install on GitHub" (link to `/api/v1/installations/install-url`), "Refresh from GitHub" and "Sign out" (POST).
- **Install link:** the API exposes `GET /api/v1/installations/install-url`, so the web app needs no config.
- **API client:** typed `fetch` wrappers with `credentials: "same-origin"`. A `401` on any query sends the user to `/`.
- **Rendering:** everything is plain text through React (no `dangerouslySetInnerHTML`). Repository names come from GitHub and are treated as untrusted.

### D13. Testing strategy
- **Unit (Jest):** cookie parsing; PKCE and state generation; constant-time compare; config rules (partial config); GitHub client with a fake `fetch` (timeouts, bad schemas, pagination caps); sync planner (diffing the read set against stored rows); the `TenantScope` query builder.
- **Integration (Jest project `integration`, real PostgreSQL and Redis):**
  - Migrations apply cleanly.
  - The sync transaction: rollback on failure, other users untouched, per-user repository access.
  - Sessions: expiry, hash-only storage.
  - **Tenant-access suite:** every tenant-scoped endpoint called by a member, a non-member and an unauthenticated client.
  - The full sign-in callback against a fake GitHub HTTP server (`node:http` on an ephemeral port; GitHub base URLs are configurable for tests only).
- **CI:** the `node` job gains `postgres:17-alpine` and `redis:7.4-alpine` service containers and runs `pnpm --filter @diffsentinel/api test:integration`. It still needs no secrets.
- **Web (Vitest):** landing messages, dashboard states (empty, suspended, truncated), the 401 redirect and sign-out.
- **Manual E2E:** with a dev GitHub App on the personal account, documented step by step in the README. It is run once and the result is recorded in tasks.

## Affected contracts, data, queue and tenant boundaries

- **API contracts (new):**
  - `GET /api/v1/auth/github/start`
  - `GET /api/v1/auth/github/callback`
  - `POST /api/v1/auth/logout`
  - `GET /api/v1/me`
  - `GET /api/v1/installations`
  - `GET /api/v1/installations/install-url`
  - `GET /api/v1/repositories?installationId=`
  - All are in OpenAPI. Error bodies use the fixed shape `{ "error": "<code>", "message": "<text>" }`.
- **Database:** the first migration (D7). From now on, schema changes go only through Prisma migrations.
- **Redis:** new key prefix `auth:pending:*` (TTL 600 s). No queues yet.
- **Tenant boundary:** introduced here. Installations and repositories are visible only through `TenantScope` (D9).

## Security considerations

`AGENTS.md` §9 rules touched:
- **R2 (no secrets in logs):**
  - The GitHub client never logs bodies.
  - Codes, tokens and session values are never logged.
  - The request logger must not log query strings for `/auth/github/callback`, because they contain `code` and `state`.
- **R3 (secrets at rest):**
  - The client secret comes from the environment only.
  - Sessions are stored as hashes.
  - GitHub user tokens are never stored (D4).
- **R4 (server-side authorization):**
  - `SessionGuard` and `TenantScope` on every tenant endpoint.
  - "Not yours" and "doesn't exist" give the same `404`.
  - Per-user repository access (D6/D9).
- **R6 (untrusted content):** GitHub-provided names and logins are rendered as text only.
- **R7 (limits):**
  - The sync caps (61 requests).
  - A 10 s timeout per GitHub request.
  - Pending sign-ins expire after 600 s.
  - The JSON body limit stays at the default.
- **R8 (CSRF-safe auth, input validation):**
  - `state` plus PKCE; single-use pending sign-in.
  - `SameSite=Lax` and HttpOnly cookies.
  - The Origin check on mutations.
  - zod-validated query parameters.
  - No open redirects.
- **R9 (revocation):**
  - Sign-out deletes the session.
  - A sync removes memberships and access GitHub no longer reports.
  - Installation removal by webhook comes in slice 2.

**Residual risk:** a user removed from an org keeps access until their next sign-in or refresh, or until their session expires (at most 8 h). Slice 2's installation webhooks shorten this. Recorded as a known risk in the threat model.

## Risks / Trade-offs

- [Sign-in latency for users with many installations: up to 61 GitHub calls] → caps, concurrency of 4, and a 10 s timeout. Sign-in is rare; measure it in Phase 3.
- [Stale access for up to 8 h after removal on GitHub] → session lifetime bound, sync at each sign-in, and slice 2 webhooks.
- [Redis outage blocks sign-in] → a clear "try again" message. Existing sessions keep working, because sessions live in PostgreSQL.
- [Hand-written GitHub client drifts from the API] → zod validation fails closed, with tests pinned to documented fields.
- [Integration tests add CI time and need service containers] → a separate Jest project and parallel jobs. Unit tests stay database-free.
- [The developer must register a GitHub App to try real sign-in] → a README guide. The system works in "not configured" mode without one.

## Migration Plan

1. Deploying applies the first migration through the Compose `migrate` service (or `prisma migrate deploy` in other environments) before the API starts.
2. Rollback: there is no prior schema, so rolling back is dropping the new tables (`prisma migrate reset` locally). The Phase 0 health endpoints don't depend on these tables.

## Open Questions

None that change the specs or tasks. The exact GitHub App permission set for later slices (`contents: read`, `pull_requests: read`, `checks: write`) is decided in slices 2–3. This slice requests no repository permissions beyond the metadata GitHub always grants.
