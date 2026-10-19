# runtime-configuration Specification

## Purpose

Makes every DiffSentinel service check its environment configuration at startup and stop clearly when it is misconfigured, so bad settings are found before any traffic is served and secret values never reach the logs.

## Requirements

### Requirement: Configuration is validated at startup
The API and the reviewer SHALL each check their required environment variables (type, format and allowed values) before accepting traffic. If any required variable is missing or invalid, the service SHALL exit with a non-zero status and SHALL NOT open its HTTP port.

#### Scenario: Required variable missing
- **WHEN** the API starts without `DATABASE_URL` set
- **THEN** the process exits with a non-zero status before listening on its port

#### Scenario: Variable has an invalid format
- **WHEN** the reviewer starts with `REDIS_URL` set to a value that is not a valid `redis://` or `rediss://` URL
- **THEN** the process exits with a non-zero status before listening on its port

#### Scenario: Port outside the valid range
- **WHEN** the API starts with its port variable set to `70000`
- **THEN** the process exits with a non-zero status

#### Scenario: Valid configuration
- **WHEN** every required variable is present and valid
- **THEN** the service starts and its liveness endpoint responds with HTTP 200

### Requirement: Validation errors name variables without revealing values
When configuration validation fails, the service SHALL log which variables are missing or invalid and why. It SHALL NOT log the values of those variables or of any other variable.

#### Scenario: Invalid secret-bearing variable
- **WHEN** `DATABASE_URL` holds a malformed value that contains a password
- **THEN** the startup error names `DATABASE_URL` as invalid and the log output does not contain the password or the full value

### Requirement: Optional settings have safe defaults
Variables that are not required (for example port numbers and log level) SHALL have documented defaults that are safe for local development. A service SHALL start with only its required variables set.

#### Scenario: Only required variables provided
- **WHEN** the API starts with only `DATABASE_URL` and `REDIS_URL` set
- **THEN** it starts on its documented default port with its default log level

### Requirement: All variables are documented in the example environment file
The repository SHALL contain a committed `.env.example` that lists every environment variable read by any service or by the compose stack, with a short comment and a non-secret placeholder or local default. Real `.env` files SHALL be excluded from version control.

#### Scenario: New variable introduced
- **WHEN** a service reads an environment variable
- **THEN** that variable appears in `.env.example` with a comment

#### Scenario: Local secrets file present
- **WHEN** a developer creates `.env` at the repository root
- **THEN** git ignores it and does not show it as an untracked file
