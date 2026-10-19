# ci-quality-gates Specification

## Purpose

Makes sure every change to DiffSentinel passes the same lint, type, test and build checks locally and in CI, so the repository stays runnable at every phase.

## Requirements

### Requirement: Root scripts run checks across all TypeScript packages
The repository root SHALL provide `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. Each SHALL run its check across every TypeScript workspace package and SHALL exit non-zero if any package fails.

#### Scenario: Type error in one package
- **WHEN** a type error is introduced in `apps/api` and `pnpm typecheck` is run
- **THEN** the command exits non-zero and reports the error location

#### Scenario: Clean workspace
- **WHEN** the workspace has no lint, type, test or build errors
- **THEN** `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` all exit zero

### Requirement: Python reviewer has equivalent checks
The reviewer SHALL support lint (Ruff), format check, strict static type checking (mypy) and tests (pytest) through `uv run`, each exiting non-zero on failure.

#### Scenario: Failing Python test
- **WHEN** a reviewer test fails and `uv run pytest` is run in `services/reviewer`
- **THEN** the command exits non-zero

### Requirement: Formatting is enforced
The lint step SHALL fail when source files do not match the configured formatter output, for both TypeScript (Prettier) and Python (Ruff format).

#### Scenario: Unformatted file
- **WHEN** a TypeScript file is committed with formatting that differs from Prettier output
- **THEN** `pnpm lint` exits non-zero and names the file

### Requirement: CI runs all gates on pushes and pull requests
A GitHub Actions workflow SHALL run on every push and every pull request. It SHALL run the TypeScript lint, typecheck, test and build steps, the Python lint, type and test steps, and a compose smoke test that starts the stack and checks the API and reviewer readiness endpoints. The workflow SHALL fail if any step fails. It SHALL install dependencies only from committed lockfiles.

#### Scenario: Pull request with a failing test
- **WHEN** a pull request contains a failing API unit test
- **THEN** the CI workflow reports failure for that pull request

#### Scenario: Lockfile out of date
- **WHEN** a `package.json` dependency changes without an updated `pnpm-lock.yaml`
- **THEN** the CI install step fails instead of resolving new versions

#### Scenario: Stack fails to become healthy
- **WHEN** the compose smoke test starts the stack and a service never becomes healthy
- **THEN** the smoke job fails and prints the container logs

### Requirement: CI uses no real secrets
The CI workflow SHALL run with only local, throwaway credentials for its own PostgreSQL and Redis containers. It SHALL NOT require GitHub App keys, OAuth secrets, or model provider API keys.

#### Scenario: Fork pull request
- **WHEN** CI runs for a pull request from a fork that has no repository secrets
- **THEN** every gate can still run to completion
