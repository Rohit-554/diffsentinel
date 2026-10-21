# Spec Delta

## Purpose

Lets a signed-in user install the DiffSentinel GitHub App on chosen repositories and see, in the dashboard, exactly which installations and repositories they can access, as verified with GitHub.

## ADDED Requirements

### Requirement: Users can start a GitHub App installation
The dashboard SHALL offer an "Install on GitHub" action that opens the configured App's GitHub installation page (`https://github.com/apps/<slug>/installations/new`). GitHub's own installation screen is where the user chooses accounts and repositories and grants permissions.

#### Scenario: Install link
- **WHEN** a signed-in user opens the dashboard
- **THEN** an "Install on GitHub" link points to the configured App's installation page

### Requirement: Returning from installation re-verifies access through sign-in
After an installation is created or changed, GitHub's redirect to the App's Setup URL SHALL lead the user through the protected sign-in flow, so that installations are synced using a freshly authorized user token. Installation or account identifiers in the redirect's query parameters SHALL NOT be trusted or stored.

#### Scenario: Return after installing
- **WHEN** GitHub redirects the user to the Setup URL with an `installation_id` query parameter
- **THEN** the user goes through sign-in, the dashboard then lists installations as reported by GitHub for that user, and the query parameter itself is not used to grant or record access

#### Scenario: Forged installation id
- **WHEN** someone visits the Setup URL with an `installation_id` of an installation they cannot access on GitHub
- **THEN** that installation does not appear in their dashboard and no membership is created

### Requirement: Installations, memberships and repositories are synced from GitHub
On every successful sign-in, and when the user chooses "Refresh from GitHub" (which repeats sign-in), the system SHALL read the installations accessible to the user and the repositories accessible to the user in each installation from GitHub, and SHALL make the stored state match it:
- create or update each installation (keyed by GitHub installation ID) and repository (keyed by GitHub repository ID);
- create a membership between the user and each accessible installation;
- record, per user, exactly which repositories GitHub reports as accessible to that user, which may be fewer than the installation covers;
- remove the user's memberships and repository access that GitHub no longer reports;
- record a suspended installation's status as `suspended`.
The sync SHALL be one transaction: on failure, the previous state remains unchanged.

#### Scenario: First sign-in after installing
- **WHEN** a user who installed the App on two repositories signs in
- **THEN** the dashboard lists that installation with exactly those two repositories

#### Scenario: Access removed on GitHub
- **WHEN** a user loses access to an installation on GitHub (for example, removed from the organization or the App was uninstalled) and then signs in or refreshes
- **THEN** their membership for that installation is removed and the installation no longer appears for them

#### Scenario: Repository selection changed
- **WHEN** the installation's repository selection on GitHub changes from two repositories to one and the user refreshes
- **THEN** the dashboard lists only the remaining repository for that installation

#### Scenario: Suspended installation
- **WHEN** GitHub reports an installation as suspended
- **THEN** it is stored with status `suspended` and shown as suspended in the dashboard

#### Scenario: GitHub fails mid-sync
- **WHEN** listing repositories for one installation fails during sync
- **THEN** sign-in fails with the "GitHub is unavailable" message and previously synced installations, memberships and repositories are unchanged

### Requirement: Sync is bounded
The sync SHALL never run unbounded. It SHALL read at most 20 installations per user and at most 300 repositories per installation, using at most 100 items per GitHub request, and so make at most 61 GitHub API requests per sync. Anything beyond these limits SHALL be left out and flagged rather than read.

#### Scenario: Too many repositories
- **WHEN** an installation reports more than 300 repositories accessible to the user
- **THEN** sync stores the first 300, marks that user's repository list for the installation as truncated, and the dashboard says not all repositories are listed

#### Scenario: Too many installations
- **WHEN** GitHub reports more than 20 installations for the user
- **THEN** sync stores the first 20 and the dashboard says not all installations are listed

### Requirement: Shared installations are modelled as memberships
An installation SHALL be shared by every user GitHub reports as able to access it. One user's sync SHALL NOT remove another user's membership.

#### Scenario: Two members of one organization
- **WHEN** two users of the same organization installation each sign in
- **THEN** both see the installation, and the installation and its repositories are stored once

#### Scenario: One member loses access
- **WHEN** one of those users loses access and refreshes
- **THEN** only that user's membership is removed, and the other user still sees the installation

#### Scenario: Members with different repository access
- **WHEN** two members of the same organization installation sign in, and GitHub reports a private repository as accessible to only one of them
- **THEN** only that member sees the private repository; the other member sees the installation without it

### Requirement: Dashboard lists the user's installations and repositories
`GET /api/v1/installations` SHALL return the installations the signed-in user is a member of, with account login, account type, status and repository count. `GET /api/v1/repositories` SHALL return repositories from those installations, with full name, default branch, visibility and installation ID, and SHALL accept an optional `installationId` filter. The web dashboard SHALL display these lists, say clearly when there are none, and offer "Install on GitHub", "Refresh from GitHub" and "Sign out".

#### Scenario: No installations yet
- **WHEN** a signed-in user has no accessible installations
- **THEN** both endpoints return empty lists and the dashboard explains how to install the App

#### Scenario: Filter by installation
- **WHEN** a user requests `GET /api/v1/repositories?installationId=<id>` for an installation they belong to
- **THEN** only that installation's repositories are returned

### Requirement: Installation syncs are audited
Each sync SHALL create an `installations.synced` audit event recording the user and the counts of installations and repositories added and removed, without repository names or tokens.

#### Scenario: Audit on sync
- **WHEN** a sign-in sync adds one installation with two repositories
- **THEN** an `installations.synced` audit event records one installation added and two repositories added for that user
