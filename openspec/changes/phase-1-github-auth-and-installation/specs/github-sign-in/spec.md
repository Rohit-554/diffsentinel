# Spec Delta

## Purpose

Lets people sign in to DiffSentinel with their GitHub account and keep a secure server-side session. GitHub identity alone never grants access to repository data.

## ADDED Requirements

### Requirement: Sign-in starts a protected GitHub authorization flow
`GET /api/v1/auth/github/start` SHALL redirect the browser to GitHub's authorization page for the configured GitHub App. The redirect SHALL include the client ID, the registered callback URL, a freshly generated unguessable `state` value and a PKCE `code_challenge` using method `S256`. The `state` value and the PKCE verifier SHALL be bound to the requesting browser in an HTTP-only cookie that expires within 10 minutes.

#### Scenario: Start sign-in
- **WHEN** a browser requests `GET /api/v1/auth/github/start`
- **THEN** the API responds with a redirect to `https://github.com/login/oauth/authorize` whose query contains `client_id`, `redirect_uri`, `state` and `code_challenge` with `code_challenge_method=S256`
- **AND** sets an HTTP-only cookie carrying the pending sign-in that expires within 10 minutes

#### Scenario: Each attempt gets a new state
- **WHEN** the same browser starts sign-in twice
- **THEN** the two redirects carry different `state` values and different code challenges

### Requirement: Callback completes sign-in only for a matching state
`GET /api/v1/auth/github/callback` SHALL accept the authorization result only if its `state` exactly matches the pending sign-in cookie (compared in constant time) and that cookie has not expired. It SHALL then exchange the `code` with the PKCE verifier, read the user's GitHub profile, create or update the user record (keyed by GitHub user ID), sync installations (see `installation-onboarding`), create a session and redirect to the dashboard. The pending sign-in cookie SHALL be cleared in every outcome.

#### Scenario: Successful sign-in
- **WHEN** GitHub redirects back with a valid `code` and a `state` matching the pending cookie
- **THEN** the API creates a session, sets the session cookie, clears the pending cookie and redirects to the web dashboard

#### Scenario: State mismatch or missing
- **WHEN** the callback arrives with a `state` that does not match the pending cookie, or with no pending cookie
- **THEN** no code exchange is attempted, no session is created, and the browser is redirected to the sign-in page with a "sign-in failed" message

#### Scenario: Expired pending sign-in
- **WHEN** the callback arrives more than 10 minutes after the sign-in started
- **THEN** sign-in is refused as for a state mismatch

#### Scenario: User denies authorization
- **WHEN** GitHub redirects back with `error=access_denied`
- **THEN** no session is created and the browser is redirected to the sign-in page with a "sign-in cancelled" message

#### Scenario: Replayed callback
- **WHEN** a callback URL that has already completed a sign-in is requested again
- **THEN** sign-in is refused, because the pending cookie was cleared on first use

### Requirement: GitHub outages fail sign-in safely
If GitHub's token exchange or user API fails, times out (bounded at 10 seconds per request) or returns an unexpected response, sign-in SHALL fail without creating a session or partial user data, and the browser SHALL be redirected to the sign-in page with a "GitHub is unavailable, try again" message. Response bodies, codes and tokens from GitHub SHALL NOT be logged or shown.

#### Scenario: Token exchange fails
- **WHEN** GitHub's token endpoint returns an error or does not answer within 10 seconds
- **THEN** no session is created and the user sees the "GitHub is unavailable" message

#### Scenario: Unexpected profile response
- **WHEN** GitHub's user API returns a body that is missing the user ID
- **THEN** sign-in fails without creating or modifying a user record

### Requirement: Sessions are server-side, opaque and expiring
A session SHALL be identified to the browser only by a random opaque value of at least 256 bits, carried in a cookie that is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` whenever the public base URL uses HTTPS. The server SHALL store only a hash of that value. Sessions SHALL expire after a fixed lifetime (default 8 hours) and SHALL be rejected after expiry.

#### Scenario: Session cookie attributes
- **WHEN** sign-in succeeds
- **THEN** the session cookie is `HttpOnly` and `SameSite=Lax`, and the raw session value is not stored in the database

#### Scenario: Expired session
- **WHEN** a request presents a session cookie whose session has expired
- **THEN** it is treated as unauthenticated

#### Scenario: Forged session value
- **WHEN** a request presents a session cookie with a value that matches no stored session
- **THEN** it is treated as unauthenticated

### Requirement: Current user endpoint
`GET /api/v1/me` SHALL return the signed-in user's DiffSentinel ID, GitHub login and display name. Without a valid session it SHALL return `401`. It SHALL NOT return any token or session value.

#### Scenario: Signed in
- **WHEN** a request with a valid session calls `GET /api/v1/me`
- **THEN** the API responds with `200` and the user's ID, GitHub login and display name

#### Scenario: Not signed in
- **WHEN** a request without a session calls `GET /api/v1/me`
- **THEN** the API responds with `401`

### Requirement: Sign-out revokes the session and resists cross-site requests
`POST /api/v1/auth/logout` SHALL delete the server-side session and clear the session cookie. It SHALL only be accepted from same-origin requests: requests whose `Origin` header is present and does not match the public base URL SHALL be rejected with `403`. Sign-out SHALL NOT be possible with a `GET` request.

#### Scenario: Sign out
- **WHEN** a signed-in user sends a same-origin `POST /api/v1/auth/logout`
- **THEN** the session is deleted, the cookie is cleared, and later requests with the old cookie are unauthenticated

#### Scenario: Cross-site sign-out attempt
- **WHEN** a `POST /api/v1/auth/logout` arrives with an `Origin` header from another site
- **THEN** the API responds with `403` and the session remains valid

### Requirement: GitHub user tokens are never persisted or logged
The GitHub user access token obtained during sign-in SHALL be used only within that request and SHALL NOT be written to the database, logs, cookies or responses.

#### Scenario: Token not stored
- **WHEN** a sign-in completes
- **THEN** no table contains the GitHub access token, and the request's log lines do not contain it

### Requirement: Sign-in can be disabled by configuration
When none of the GitHub App settings (client ID, client secret, App slug, public base URL) are configured, the API SHALL still start. Sign-in endpoints SHALL respond with `503` and a fixed "GitHub sign-in is not configured" message, and the web app SHALL show that sign-in is unavailable. When only some of them are configured, the API SHALL treat this as invalid configuration and exit at startup, naming the missing variables.

#### Scenario: Not configured
- **WHEN** the API runs without any GitHub App settings and a browser requests `GET /api/v1/auth/github/start`
- **THEN** the API responds with `503` and the "GitHub sign-in is not configured" message, and the health endpoints are unaffected

#### Scenario: Partially configured
- **WHEN** the API starts with a GitHub client ID but no client secret
- **THEN** the process exits with a non-zero status before listening, naming the missing variable without printing any values

### Requirement: Sign-in events are audited
Successful sign-ins, failed sign-ins (with a fixed reason category) and sign-outs SHALL each create an audit event recording the actor (when known), the action and the time, without tokens, codes or session values.

#### Scenario: Audit on sign-in
- **WHEN** a user signs in successfully
- **THEN** an `auth.sign_in` audit event exists for that user
