# Spec Delta

## Purpose

Gives developers one reproducible command that starts the whole DiffSentinel system locally (data stores, API, reviewer and web) in the correct order, with health tracked for each service.

## ADDED Requirements

### Requirement: Single command starts the full system
Running `docker compose -f infra/docker-compose.yml up` from the repository root SHALL build and start PostgreSQL, Redis, the API, the reviewer and the web application without any manual steps beyond having Docker available. Copying `.env.example` to `.env` SHALL be optional for local use.

#### Scenario: Fresh clone startup
- **WHEN** a developer runs the compose up command on a fresh clone with no `.env` file
- **THEN** all five services start and every one with a healthcheck reaches the healthy state

#### Scenario: Web reachable through the stack
- **WHEN** the stack is healthy and the developer opens the web application's local URL
- **THEN** the status view loads and shows the system as operational, with API requests served through the web origin

### Requirement: Services start in dependency order
The API SHALL NOT start until PostgreSQL and Redis report healthy. The reviewer SHALL NOT start until Redis reports healthy. The web application SHALL NOT start until the API reports healthy.

#### Scenario: Database still initialising
- **WHEN** the stack starts and PostgreSQL has not yet passed its healthcheck
- **THEN** the API container has not started

### Requirement: Every service has a healthcheck
Each compose service SHALL define a healthcheck. Application services SHALL use their liveness endpoints. Data services SHALL use their native readiness commands.

#### Scenario: Waiting for healthy stack
- **WHEN** a developer or CI runs compose up with the wait option
- **THEN** the command returns success only after every service reports healthy, and fails if any service becomes unhealthy or exits

### Requirement: Data services are not exposed beyond localhost
PostgreSQL and Redis host port mappings SHALL bind only to the loopback interface. Application containers SHALL run as a non-root user.

#### Scenario: Port binding
- **WHEN** the stack is running
- **THEN** the PostgreSQL and Redis published ports are bound to `127.0.0.1`, not `0.0.0.0`

### Requirement: Local data persists across restarts and can be reset
PostgreSQL data SHALL be stored in a named volume, so stopping and starting the stack keeps the data. Removing the volumes SHALL reset the stack to a clean state.

#### Scenario: Restart keeps data
- **WHEN** the stack is stopped with `down` (without removing volumes) and started again
- **THEN** PostgreSQL data from the previous run is still present

#### Scenario: Reset
- **WHEN** the stack is stopped with `down -v`
- **THEN** the next start begins with an empty database
