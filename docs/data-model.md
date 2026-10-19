# Data model

> **Status: planned.** No tables exist yet. Phase 0 only connects to PostgreSQL through Prisma with an empty schema (`apps/api/prisma/schema.prisma`). The first migration, in Phase 1, will create these tables. Column names and types below are the starting design and may change in that migration.

PostgreSQL is the system of record and is owned by the API. All tables use surrogate `id` primary keys (UUID), `created_at`/`updated_at` timestamps (`timestamptz`), foreign keys, and unique constraints for every natural key received from GitHub.

## Entity overview

```text
users ──< installation_members >── installations ──< repositories ──< review_runs ──< findings
                                         │                                 │
                                         └──< webhook_deliveries >─────────┘ (delivery that triggered a run)

audit_events: append-only log referencing any of the above by type + id
```

## Tables

### `users`

People who sign in with GitHub. Signing in proves identity only; it does **not** grant access to any repository.

| Column           | Type        | Notes                        |
| ---------------- | ----------- | ---------------------------- |
| `id`             | uuid PK     |                              |
| `github_user_id` | bigint      | **unique**; stable GitHub id |
| `display_name`   | text        | GitHub login or name         |
| `created_at`     | timestamptz |                              |

### `installations`

One GitHub App installation on a user or organisation account.

| Column                     | Type        | Notes                                      |
| -------------------------- | ----------- | ------------------------------------------ |
| `id`                       | uuid PK     |                                            |
| `github_installation_id`   | bigint      | **unique**                                 |
| `account_id`               | bigint      | GitHub account (user or org) it belongs to |
| `account_login`            | text        | for display                                |
| `status`                   | enum        | `active`, `suspended`, `removed`           |
| `created_at`, `updated_at` | timestamptz |                                            |

### `installation_members` (users ↔ installations, many-to-many)

An installation on an organisation is used by many people, and one person can use many installations, so access is modelled as a membership row, not ownership. Rows are created or refreshed from GitHub (installation and membership data) and are the basis of every authorization check.

| Column            | Type                         | Notes                                      |
| ----------------- | ---------------------------- | ------------------------------------------ |
| `user_id`         | uuid FK → `users.id`         | on delete cascade                          |
| `installation_id` | uuid FK → `installations.id` | on delete cascade                          |
| `role`            | enum                         | e.g. `admin`, `member`, from GitHub        |
| `verified_at`     | timestamptz                  | when access was last confirmed with GitHub |

Primary key: `(user_id, installation_id)`.

### `repositories`

Repositories selected for an installation.

| Column                     | Type                         | Notes                                            |
| -------------------------- | ---------------------------- | ------------------------------------------------ |
| `id`                       | uuid PK                      |                                                  |
| `github_repository_id`     | bigint                       | **unique**                                       |
| `installation_id`          | uuid FK → `installations.id` |                                                  |
| `full_name`                | text                         | `owner/name`                                     |
| `default_branch`           | text                         |                                                  |
| `enabled`                  | boolean                      | reviews run only when true                       |
| `llm_review_enabled`       | boolean                      | per-repository opt-out of third-party LLM review |
| `created_at`, `updated_at` | timestamptz                  |                                                  |

### `webhook_deliveries`

Every accepted webhook is recorded **before** the API responds, so a retried delivery is recognised and a crash after acknowledging can be recovered.

| Column               | Type                                   | Notes                                            |
| -------------------- | -------------------------------------- | ------------------------------------------------ |
| `id`                 | uuid PK                                |                                                  |
| `github_delivery_id` | text                                   | **unique**; the `X-GitHub-Delivery` header       |
| `event_type`         | text                                   | e.g. `pull_request`, `installation`              |
| `installation_id`    | uuid FK → `installations.id`, nullable | null for events before the installation is known |
| `received_at`        | timestamptz                            |                                                  |
| `processing_state`   | enum                                   | `received`, `processed`, `ignored`, `failed`     |

Raw payloads are not stored by default (they can contain private repository data).

### `review_runs`

One review of one pull request at one head commit with one analyzer version.

| Column                                           | Type                                        | Notes                                                                          |
| ------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------ |
| `id`                                             | uuid PK                                     |                                                                                |
| `installation_id`                                | uuid FK → `installations.id`                |                                                                                |
| `repository_id`                                  | uuid FK → `repositories.id`                 |                                                                                |
| `pr_number`                                      | integer                                     |                                                                                |
| `head_sha`                                       | text                                        | the only commit this run reviews                                               |
| `analysis_version`                               | text                                        | analyzer + prompt version                                                      |
| `trigger_delivery_id`                            | uuid FK → `webhook_deliveries.id`, nullable | null for manual re-reviews                                                     |
| `status`                                         | enum                                        | `RECEIVED`, `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, `CANCELLED` |
| `attempts`                                       | integer                                     |                                                                                |
| `error_code`                                     | text, nullable                              | fixed error category, never raw error text                                     |
| `is_stale`                                       | boolean                                     | true once a newer head SHA exists for the PR                                   |
| `started_at`, `completed_at`                     | timestamptz, nullable                       |                                                                                |
| `input_tokens`, `output_tokens`                  | integer                                     | estimates                                                                      |
| `estimated_cost_usd`                             | numeric                                     |                                                                                |
| `model_provider`, `model_name`, `prompt_version` | text, nullable                              |                                                                                |
| `created_at`, `updated_at`                       | timestamptz                                 |                                                                                |

**Idempotency constraint:** unique `(installation_id, repository_id, pr_number, head_sha, analysis_version)`. A redelivered webhook, or two deliveries for the same commit, maps to the same row instead of creating a second run, charging twice or posting twice.

Allowed status transitions (enforced in application code, covered by unit tests):

```text
RECEIVED → QUEUED → RUNNING → COMPLETED
                         └──→ FAILED
RECEIVED | QUEUED | RUNNING → SKIPPED | CANCELLED
```

### `findings`

| Column                                     | Type                       | Notes                                                       |
| ------------------------------------------ | -------------------------- | ----------------------------------------------------------- |
| `id`                                       | uuid PK                    |                                                             |
| `review_run_id`                            | uuid FK → `review_runs.id` | on delete cascade                                           |
| `source`                                   | enum                       | `static` (deterministic analyzer) or `llm` (suspected)      |
| `rule_id`                                  | text                       | e.g. `DIVIDE_BY_ZERO`                                       |
| `severity`                                 | enum                       | `info`, `low`, `medium`, `high`, `critical`                 |
| `confidence`                               | numeric                    | 0.0–1.0                                                     |
| `path`                                     | text                       | must be a file changed in the PR                            |
| `start_line`, `end_line`                   | integer                    | must fall on changed lines                                  |
| `title`, `explanation`, `suggested_change` | text                       | model output is escaped before display or posting           |
| `fingerprint`                              | text                       | stable hash of rule + location + content, for deduplication |
| `publication_state`                        | enum                       | `unpublished`, `published`, `failed`                        |
| `triage_state`                             | enum                       | `open`, `acknowledged`, `dismissed`                         |
| `created_at`                               | timestamptz                |                                                             |

Unique `(review_run_id, fingerprint)` prevents duplicate findings within a run.

### `audit_events`

Append-only record of security-relevant actions (sign-in, installation changes, repository settings, manual re-review, data deletion).

| Column          | Type                           | Notes                                  |
| --------------- | ------------------------------ | -------------------------------------- |
| `id`            | uuid PK                        |                                        |
| `actor_user_id` | uuid FK → `users.id`, nullable | null for GitHub or system actions      |
| `action`        | text                           | e.g. `repository.settings.updated`     |
| `resource_type` | text                           |                                        |
| `resource_id`   | text                           |                                        |
| `occurred_at`   | timestamptz                    |                                        |
| `metadata`      | jsonb                          | minimal; never tokens, secrets or code |

## Tenant isolation

Every query for repositories, review runs or findings is scoped through `installation_members` for the signed-in user. Repository or review IDs sent by the browser are never trusted on their own. Removing an installation marks it `removed`, stops new reviews, and triggers the retention policy for its data.
