# Threat model

This is a STRIDE threat model for the full planned DiffSentinel system. It is written now, in Phase 0, so the Phase 1 webhook and auth work starts from documented threats. It is reviewed whenever a trust boundary changes.

Controls refer to the security rules in [`AGENTS.md`](../AGENTS.md) §9:

| Rule | Control                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| R1   | Verify webhook HMAC-SHA256 on the raw body with constant-time comparison              |
| R2   | Never log tokens, secrets, API keys or raw private diffs                              |
| R3   | Secrets encrypted at rest (KMS); installation tokens short-lived and kept in memory   |
| R4   | Server-side authorization on every tenant-sensitive endpoint; never trust browser IDs |
| R5   | Never execute repository or PR code in the MVP                                        |
| R6   | Treat diffs, issue bodies, READMEs and tool output as untrusted (prompt injection)    |
| R7   | Hard limits on diff size, file count, tokens, API requests, retries and cost          |
| R8   | Parameterised queries, CSRF-safe auth, secure HTTP-only cookies, input validation     |
| R9   | Repository disablement, installation removal, retention and revocation handling       |
| R10  | No automatic merge or contributor-branch writes; explicit approval for draft fix PRs  |

## Assets

| Asset                                  | Why it matters                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| Private source code and diffs          | Customer IP; confidentiality is the main promise                   |
| GitHub App private key, webhook secret | Forging webhooks or minting installation tokens for every customer |
| Installation tokens, OAuth tokens      | Direct read (and possibly write) access to customer repositories   |
| Model provider API key                 | Cost abuse; sending data to the wrong account                      |
| Review results and findings            | May describe vulnerabilities in private code                       |
| Tenant mapping (users ↔ installations) | Basis of every authorization decision                              |
| Availability and spend budget          | Queue floods or runaway model calls cost money and block reviews   |

## Trust boundaries

```text
            (B1)                         (B2)                      (B4)
GitHub ──webhooks / API──> API ──queue──> Reviewer ──prompts──> LLM provider
                            ▲     (B3)        │
              (B5) browser ─┘                 └──> GitHub API (installation token)
                            │
                        PostgreSQL / Redis (B6: internal data stores)
```

- **B1 GitHub ↔ API:** inbound webhooks (public endpoint) and outbound GitHub API calls.
- **B2 API ↔ Reviewer:** jobs passed through Redis/BullMQ.
- **B3 Reviewer ↔ GitHub:** fetching diffs and file context with installation tokens.
- **B4 Reviewer ↔ LLM provider:** code leaves our infrastructure.
- **B5 Browser ↔ Web/API:** signed-in users, session cookies.
- **B6 Services ↔ data stores:** PostgreSQL and Redis.

## Threats and controls

| ID  | Boundary | STRIDE                  | Threat                                                                           | Controls | Phase 0 status                                                                   |
| --- | -------- | ----------------------- | -------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| T1  | B1       | Spoofing                | Attacker forges a `pull_request` webhook to trigger reviews or poison results    | R1       | Planned (Phase 1); no webhook route exists yet                                   |
| T2  | B1       | Tampering / Repudiation | Replayed or redelivered webhook creates duplicate runs, charges or comments      | R1, R7   | Planned: delivery-ID and review idempotency keys (see data-model.md)             |
| T3  | B1       | Denial of service       | Webhook flood or oversized payload exhausts the API or queue                     | R7       | Planned: body size limit, fast acknowledge, queue limits                         |
| T4  | B1/B3    | Elevation of privilege  | Over-broad GitHub App permissions let a compromise write to repositories         | R10, R3  | Planned: read-only permissions by default; write only when publishing is enabled |
| T5  | B3       | Information disclosure  | Installation token leaks through logs, errors or persisted job payloads          | R2, R3   | Pattern in place: logs record error class/code only; config errors omit values   |
| T6  | B2       | Tampering               | Job payload altered in Redis to review another tenant's repository               | R4, R3   | Planned: jobs carry IDs only; worker re-checks installation before fetching      |
| T7  | B4       | Information disclosure  | Private code sent to a third-party model without consent                         | R6, R9   | Planned: per-repository LLM opt-out (`llm_review_enabled`), documented transfer  |
| T8  | B4       | Tampering               | Prompt injection in a diff or README makes the model invent or suppress findings | R6       | Planned: untrusted-content framing, schema validation, changed-line checks       |
| T9  | B4/B5    | Tampering (XSS)         | Model output with HTML or malicious links rendered in the dashboard or on GitHub | R6, R8   | Planned: escape all model output; React escapes by default                       |
| T10 | B4       | Denial of service       | Huge PRs or runaway retries drive model cost and latency                         | R7       | Planned: byte/file/token budgets, timeouts, circuit breaker                      |
| T11 | B3       | Elevation of privilege  | Reviewer executes code from the repository (build scripts, tests)                | R5       | Enforced by design: no code execution in the MVP                                 |
| T12 | B5       | Spoofing                | Session hijack or login CSRF on the GitHub OAuth flow                            | R8       | Planned (Phase 1): state parameter, HTTP-only secure cookies                     |
| T13 | B5       | Information disclosure  | User reads another tenant's repositories, reviews or findings by changing an ID  | R4       | Planned: every query scoped through installation membership                      |
| T14 | B5       | Elevation of privilege  | User is removed from an org or the app is uninstalled but keeps access           | R4, R9   | Planned: membership re-verification; installation removal handling               |
| T15 | B5       | Tampering               | Generated fix is merged or pushed without a person approving it                  | R10      | Out of MVP; draft PR only, after explicit approval                               |
| T16 | B6       | Tampering               | SQL injection through user input or GitHub data                                  | R8       | Prisma ORM with parameterised queries; no raw SQL beyond the fixed health probe  |
| T17 | B6       | Information disclosure  | Data stores reachable from outside the host or network                           | R3       | In place: Compose publishes PostgreSQL and Redis on 127.0.0.1 only               |
| T18 | B6       | Information disclosure  | Secrets committed to git or baked into images                                    | R2, R3   | In place: `.env` git-ignored and Docker-ignored; CI uses no secrets              |
| T19 | B1–B6    | Repudiation             | No record of who changed settings, re-ran reviews or deleted data                | R9       | Planned: `audit_events` table                                                    |
| T20 | All      | Information disclosure  | Readiness endpoint reveals dependency state to anyone                            | R2       | Accepted for Phase 0: no hosts or errors exposed; restrict in Phase 3            |

## Controls in place in Phase 0

- Config validation fails closed and never prints values (API and reviewer).
- Health responses expose fixed error categories only; logs record error class and code, never driver messages (R2).
- Readiness checks are time-limited (2 s), so a hung dependency can't hang the endpoint (R7).
- Containers run as non-root; data stores bind to loopback; images are pinned by tag; dependencies are installed from lockfiles only (R3).
- CI uses a read-only `GITHUB_TOKEN` and no repository secrets.

## Open items for Phase 1

1. Webhook route: raw-body HMAC verification, delivery-ID deduplication, size limit and fast acknowledgement (T1–T3).
2. OAuth flow with state and secure, HTTP-only, SameSite cookies (T12).
3. Authorization policy module, tested for cross-tenant access before any data endpoint ships (T13, T14).
4. Installation token handling: minted per job, kept in memory, never logged or queued (T5, T6).
