# Proposal

## Why

DiffSentinel can't do anything useful until people can sign in and connect repositories. This change is the first slice of **Phase 1 (GitHub end-to-end integration)**. It covers identity and access: GitHub sign-in, GitHub App installation, and a server-side authorization policy that every later tenant-scoped feature (webhooks, review runs, findings) builds on.

**Delivery phase:** Phase 1, slice 1 of 3. Planned follow-ups:
- Slice 2: signed webhook ingestion, delivery deduplication and durable review records.
- Slice 3: BullMQ dispatch, worker diff fetch with installation tokens, and the review lifecycle in the dashboard.

## What Changes

- **GitHub sign-in:**
  - Uses the GitHub App's user authorization flow: one App, no separate OAuth App.
  - Protected by `state` and PKCE (S256).
  - Routes: `GET /api/v1/auth/github/start`, `GET /api/v1/auth/github/callback`, `POST /api/v1/auth/logout`, `GET /api/v1/me`.
- **Server-side sessions:**
  - Stored in PostgreSQL. The browser holds only a random opaque session ID in an HTTP-only, `SameSite=Lax` cookie (`Secure` over HTTPS).
  - Sessions expire and can be revoked by signing out.
- **GitHub user access tokens are never stored.** The token is used only inside the sign-in callback, to read the user's profile, installations and repositories, and is then discarded.
- **Installation onboarding:**
  - An "Install on GitHub" link to the App's install page.
  - The App's Setup URL brings the user back through sign-in.
  - Every sign-in re-syncs the user's installations, memberships and repositories from GitHub.
- **Read endpoints:** `GET /api/v1/installations` and `GET /api/v1/repositories`, returning only what the signed-in user can access.
- **Authorization policy:**
  - One server-side policy decides access, based on installation membership verified with GitHub.
  - Unauthenticated requests get `401`. A resource that exists but belongs to another tenant answers exactly like one that doesn't exist (`404`).
- **First database migration:** `users`, `installations`, `installation_members`, `repositories`, `repository_access` (per-user repository access as reported by GitHub), `sessions`, `audit_events`.
  - Migrations run automatically before the API starts in Docker Compose.
- **Audit events** for sign-in, sign-out and installation sync.
- **Web:**
  - A signed-out landing page with "Sign in with GitHub".
  - A signed-in dashboard listing installations and their repositories, with "Install on GitHub" and "Refresh from GitHub" actions and sign-out.
  - The existing system status view moves into a status panel.
- **Optional configuration:**
  - GitHub settings (`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `PUBLIC_BASE_URL`) are optional.
  - Without them the system still starts, and sign-in reports that it isn't configured. Compose and CI keep working with no secrets.
- **Docs:**
  - A README guide for registering a development GitHub App.
  - Updates to `docs/data-model.md`, `docs/threat-model.md` (T12–T14 move from planned to implemented) and `docs/architecture.md`.

## Non-goals

- Webhook endpoint, signature verification, `webhook_deliveries` and `installation`/`installation_repositories` webhook events (slice 2). Until then, installation changes are picked up at the user's next sign-in or refresh.
- `review_runs`, `findings`, BullMQ queues, installation access tokens, the App private key, and fetching any repository contents or diffs (slices 2–3).
- Repository settings (`PATCH /repositories/:id/settings`), enabling or disabling repositories, and LLM opt-out controls (Phase 2).
- Roles beyond "member of an installation" (Phase 3 RBAC), rate limiting and data-retention jobs (Phase 3).
- Storing or refreshing GitHub user tokens, background re-verification of memberships, and multi-account or enterprise installations.

## Capabilities

### New Capabilities

- `github-sign-in`:
  - Sign-in through GitHub with `state` and PKCE, sessions, sign-out and `GET /me`.
  - Failure handling: denied consent, a mismatched or expired `state`, GitHub outages, sign-in not configured.
  - Cookie and CSRF protections.
- `installation-onboarding`:
  - Installing the GitHub App and returning through the Setup URL.
  - Syncing installations, memberships and repositories from GitHub on sign-in and refresh, including suspended and removed installations and limits on how much is synced.
  - The dashboard listing.
- `tenant-access`:
  - The authorization policy for tenant-scoped API endpoints: `401` without a session, identical responses for "not yours" and "doesn't exist", no trust in client-supplied identifiers, and access that follows GitHub membership changes at the next sync.

### Modified Capabilities

None.
- **`runtime-configuration`:** its requirements already cover new variables (validated, documented in `.env.example`, values never logged), and the new GitHub variables are optional.
- **`local-environment`:** still starts with one command and no `.env`. Running migrations is an implementation detail.

## Impact

- **Code:**
  - `apps/api`: new `auth`, `github`, `installations` and `authz` modules, Prisma schema and migration.
  - `apps/web`: routing, session-aware pages, API client.
  - `infra/docker-compose.yml`: migration step before the API starts.
  - `.env.example`, README, docs.
- **APIs:** six new `/api/v1` routes (see What Changes), added to the OpenAPI docs.
- **Database:** first migration. Six tables, with foreign keys and unique constraints.
- **Dependencies:** none expected beyond what's installed. GitHub REST calls use `fetch`, with response validation in zod. If a cookie parser is needed, its tradeoff will be recorded in the design.
- **External systems:** a GitHub App registered by the developer (on the personal account) for end-to-end testing. Automated tests use a mocked GitHub API and need no credentials.
- **Security:** adds the first authenticated, tenant-scoped surface. See `design.md`, Security considerations.
