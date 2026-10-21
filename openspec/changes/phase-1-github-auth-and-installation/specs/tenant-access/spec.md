# Spec Delta

## Purpose

Defines the one server-side authorization policy that decides which installations and repositories a signed-in user may see, so that no tenant can read another tenant's data.

## ADDED Requirements

### Requirement: Tenant-scoped endpoints require a session
Every endpoint that returns or changes installation, repository or other tenant data SHALL require a valid session and SHALL respond with `401` without one. Health endpoints, the OpenAPI document and sign-in endpoints are not tenant-scoped.

#### Scenario: No session
- **WHEN** a request without a session calls `GET /api/v1/installations` or `GET /api/v1/repositories`
- **THEN** the API responds with `401` and returns no data

### Requirement: Access is granted only through access verified with GitHub
A user SHALL be able to read an installation only while a membership links them to it and its status is not `removed`. A user SHALL be able to read a repository only if, in addition, the last sync recorded that GitHub reports that repository as accessible to that user. Signing in with GitHub SHALL NOT by itself grant access to any installation or repository.

#### Scenario: Member reads own data
- **WHEN** a member of installation A lists repositories
- **THEN** the response contains only repositories from installation A that GitHub reported as accessible to that user

#### Scenario: Repository in a shared installation the user cannot access
- **WHEN** installation A contains private repository P, which GitHub reported as accessible to user X but not to user Y, and Y lists repositories
- **THEN** P is not in Y's response

#### Scenario: Signed in without installations
- **WHEN** a signed-in user with no memberships lists installations and repositories
- **THEN** both lists are empty

### Requirement: Other tenants' resources are indistinguishable from missing ones
Requests that name an installation or repository by ID (in the path, query or body) SHALL be checked against the policy on the server. A resource the user cannot access SHALL produce the same response as one that does not exist: `404`, with the same body. Client-supplied identifiers SHALL never widen access.

#### Scenario: Cross-tenant filter
- **WHEN** a member of installation A requests `GET /api/v1/repositories?installationId=<B>` for an installation B they do not belong to
- **THEN** the API responds with `404`, exactly as it does for an installation ID that does not exist

#### Scenario: Malformed identifier
- **WHEN** a request supplies an `installationId` that is not a valid ID
- **THEN** the API responds with `400` and does not run the query

### Requirement: Access follows GitHub membership changes
When a sync removes a user's membership, that user SHALL lose access to the installation and its repositories immediately, including in sessions that are already open.

#### Scenario: Membership removed while signed in
- **WHEN** user U has two open sessions and a sync from one of them removes U's membership in installation A
- **THEN** requests from both sessions no longer return installation A or its repositories

### Requirement: Policy is enforced in one place and tested for cross-tenant access
Tenant scoping SHALL be applied by one shared policy component used by all tenant-scoped queries, rather than re-implemented per endpoint. Automated tests SHALL cover, for each tenant-scoped endpoint, access by a member, a non-member and an unauthenticated client.

#### Scenario: New endpoint coverage
- **WHEN** the tenant-access test suite runs
- **THEN** every tenant-scoped endpoint is exercised with member, non-member and unauthenticated requests, and non-member requests return no data from other tenants
