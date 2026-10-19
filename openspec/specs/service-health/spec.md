# service-health Specification

## Purpose

Lets operators, container orchestration and the web UI find out whether each DiffSentinel service is running and whether it can reach the infrastructure it depends on, without revealing any secrets.

## Requirements

### Requirement: API liveness endpoint
The API SHALL expose `GET /api/v1/health`. It SHALL respond with HTTP 200 and a JSON body containing `status: "ok"` and the service name whenever the API process is running and able to serve requests. The answer SHALL NOT depend on PostgreSQL or Redis being reachable.

#### Scenario: API process is running
- **WHEN** a client sends `GET /api/v1/health`
- **THEN** the API responds with HTTP 200 and a JSON body containing `"status": "ok"` and `"service": "api"`

#### Scenario: Dependencies are down but the process is up
- **WHEN** PostgreSQL and Redis are both unreachable and a client sends `GET /api/v1/health`
- **THEN** the API still responds with HTTP 200 and `"status": "ok"`

### Requirement: API readiness endpoint
The API SHALL expose `GET /api/v1/health/ready`. It SHALL check PostgreSQL and Redis and report a separate result for each one, with `status` set to `"up"` or `"down"`. The API SHALL respond with HTTP 200 and overall `status: "ok"` only when every dependency is up. Otherwise it SHALL respond with HTTP 503 and overall `status: "unavailable"`.

#### Scenario: All dependencies reachable
- **WHEN** PostgreSQL and Redis both answer the check and a client sends `GET /api/v1/health/ready`
- **THEN** the API responds with HTTP 200, `"status": "ok"`, and `"up"` for both `postgres` and `redis`

#### Scenario: PostgreSQL unreachable
- **WHEN** PostgreSQL cannot be reached and Redis can, and a client sends `GET /api/v1/health/ready`
- **THEN** the API responds with HTTP 503, `"status": "unavailable"`, `postgres` reported as `"down"`, and `redis` reported as `"up"`

#### Scenario: Redis unreachable
- **WHEN** Redis cannot be reached and PostgreSQL can, and a client sends `GET /api/v1/health/ready`
- **THEN** the API responds with HTTP 503, `"status": "unavailable"`, and `redis` reported as `"down"`

### Requirement: Dependency checks are time-bounded
Each dependency check SHALL finish within a fixed timeout of no more than 2 seconds. A check that does not finish in time SHALL be reported as `"down"`. The readiness endpoint SHALL NOT hang waiting on a dependency that never answers.

#### Scenario: Dependency hangs
- **WHEN** a dependency accepts the connection but never answers the check
- **THEN** the readiness response arrives within the timeout plus a small margin and reports that dependency as `"down"`

### Requirement: Health responses do not leak sensitive details
Health responses SHALL NOT include connection strings, hostnames with credentials, passwords, tokens, stack traces, or raw driver error messages. A failed check SHALL expose at most a short, fixed error category (for example `"timeout"` or `"unreachable"`).

#### Scenario: Dependency fails with a detailed driver error
- **WHEN** a dependency check fails and the driver error text includes the connection URL
- **THEN** the readiness response for that dependency contains only `"status": "down"` and a fixed error category, and does not contain the URL, password or stack trace

### Requirement: Reviewer liveness and readiness endpoints
The reviewer service SHALL expose `GET /health`, which returns HTTP 200 with `status: "ok"` and `service: "reviewer"` whenever the process is running. It SHALL also expose `GET /health/ready`, which checks Redis with the same up/down reporting, timeout and no-leak rules as the API readiness endpoint. It returns HTTP 200 when Redis is up and HTTP 503 when it is down.

#### Scenario: Reviewer running with Redis available
- **WHEN** Redis is reachable and a client sends `GET /health/ready` to the reviewer
- **THEN** the reviewer responds with HTTP 200, `"status": "ok"`, and `redis` reported as `"up"`

#### Scenario: Reviewer running with Redis unavailable
- **WHEN** Redis is unreachable and a client sends `GET /health/ready` to the reviewer
- **THEN** the reviewer responds with HTTP 503, `"status": "unavailable"`, and `redis` reported as `"down"` with no connection details

#### Scenario: Reviewer liveness without Redis
- **WHEN** Redis is unreachable and a client sends `GET /health` to the reviewer
- **THEN** the reviewer responds with HTTP 200 and `"status": "ok"`

### Requirement: Web application shows system status
The web application SHALL show a status view that reads the API readiness endpoint and displays, in accessible text (not color alone), whether the system is operational and the state of each reported dependency. If the API cannot be reached at all, the view SHALL say the API is unavailable instead of showing a blank page or an unhandled error.

#### Scenario: System healthy
- **WHEN** the readiness endpoint returns HTTP 200 with every dependency `"up"`
- **THEN** the status view says the system is operational and lists each dependency as up

#### Scenario: One dependency down
- **WHEN** the readiness endpoint returns HTTP 503 with `redis` reported as `"down"`
- **THEN** the status view says the system is degraded and lists `redis` as down in text

#### Scenario: API unreachable
- **WHEN** the request to the readiness endpoint fails with a network error
- **THEN** the status view shows an "API unavailable" message and the page stays usable
