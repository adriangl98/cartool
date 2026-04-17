# E06 — Auth & User Management

**Phase:** Phase 3 (Weeks 9–11, can begin in parallel with E05)  
**Goal:** Implement secure user registration, login, JWT issuance/refresh/revoke, and saved search management.  
**Spec Reference:** §7 (Auth endpoints), §11.1 (OWASP A01, A02, A07)  
**Depends On:** E01 (F01.1 — `users` and `saved_searches` tables)

---

## Security Rules (Non-Negotiable)

- Passwords hashed with **bcrypt, cost factor 12** (spec §11.1 A02)
- JWTs signed with **RS256** (asymmetric key pair — public key verifiable by all services) (spec §11.1 A02)
- Access token TTL: **15 minutes**; Refresh token TTL: **7 days** (spec §11.1 A07)
- Refresh tokens stored as **`HttpOnly` cookies only** — never in a response body (spec §11.1 A07)
- All saved searches are **scoped to `user_id`** — no user can read another user's saved searches (spec §11.1 A01)

---

## Features

### F06.1 — User Registration & Login

**Description:** Allow users to create an account and receive a JWT access token.

**Tasks:**
- [ ] `POST /users/register`:
  - Request body: `{ email, password }` (validated: email format, password min 10 chars)
  - Hash password with `bcrypt` (cost 12)
  - Insert into `users` table
  - Return access token (JWT) and set refresh token as `HttpOnly` cookie
  - Return 409 if email already exists
- [ ] `POST /users/login`:
  - Validate credentials against `bcrypt.compare`
  - On success: issue new access token + rotate refresh token cookie
  - On failure: return 401 — **do not** distinguish between "email not found" and "wrong password" in the response (prevents user enumeration)
- [ ] Rate limit login endpoint: **10 requests/min per IP** (tighter than global limit)

**Acceptance Criteria:**
- Registering with a duplicate email returns 409.
- Login with wrong password returns 401 with an identical body to "user not found" (no oracle).
- The refresh token is never present in the JSON response body — only in the `Set-Cookie` header with `HttpOnly; Secure; SameSite=Strict`.
- Brute-force check: 11 login attempts in 1 minute returns 429 on the 11th.

---

### F06.2 — JWT Issuance & Verification Middleware

**Description:** Generate RS256 JWTs and provide a reusable verification middleware for all protected routes.

**Tasks:**
- [ ] Generate an RSA-2048 key pair on first startup; store private key in AWS Secrets Manager, public key in an accessible config
- [ ] `issueAccessToken(userId, role) -> string`: signs a JWT with `{ sub: userId, role, exp: +15min }` using RS256
- [ ] `issueRefreshToken(userId) -> string`: signs a longer-lived JWT with `{ sub: userId, exp: +7days, type: "refresh" }`
- [ ] `requireAuth` middleware: verifies the Bearer token in the `Authorization` header; attaches `req.user = { id, role }` on success; returns 401 on failure
- [ ] `requireRole(role)` middleware: checks `req.user.role === role`; returns 403 on mismatch

**Acceptance Criteria:**
- An expired access token (test by mocking clock) returns 401.
- A token signed with a different private key returns 401.
- `requireRole('admin')` allows an admin token through and rejects a user token with 403.

---

### F06.3 — Token Refresh & Revocation

**Description:** Allow clients to get a new access token using the `HttpOnly` refresh token cookie.

**Tasks:**
- [ ] `POST /auth/refresh`:
  - Read refresh token from `HttpOnly` cookie (not from request body)
  - Verify token signature and expiry
  - Issue a new access token
  - Rotate the refresh token (invalidate old, issue new cookie)
- [ ] `POST /auth/logout`:
  - Clear the `HttpOnly` refresh token cookie
  - Optionally add the refresh token's `jti` to a Redis blocklist (TTL = remaining token lifetime)
- [ ] Token rotation: a refresh token can only be used once — replaying an old refresh token returns 401

**Acceptance Criteria:**
- A valid refresh token returns a new access token and sets a new refresh cookie.
- Replaying an already-used refresh token returns 401.
- After logout, calling `POST /auth/refresh` returns 401.

---

### F06.4 — Saved Searches CRUD

**Description:** Allow authenticated users to save, retrieve, update, and delete Reverse Search configurations with optional deal score alerts.

**Tasks:**
- [ ] `POST /users/saved-searches` (requires `requireAuth`):
  - Request body: `{ max_monthly, max_down, term_months, preferred_makes, score_threshold, alert_enabled }` (all optional fields)
  - Insert into `saved_searches` with `user_id = req.user.id` — never trust a `user_id` in the request body (spec §11.1 A01)
  - Return the created record
- [ ] `GET /users/saved-searches` (requires `requireAuth`):
  - Query `saved_searches WHERE user_id = req.user.id` only — parameterized
  - Return the user's saved searches
- [ ] `PATCH /users/saved-searches/:id` (requires `requireAuth`):
  - Verify `saved_searches.user_id = req.user.id` before updating — return 404 if not found or belongs to another user
- [ ] `DELETE /users/saved-searches/:id` (requires `requireAuth`):
  - Same ownership check; return 204 on success

**Acceptance Criteria:**
- User A cannot read, update, or delete User B's saved searches (access control test).
- A request with a valid JWT but a `user_id` in the body that doesn't match the JWT `sub` is still scoped to the JWT's user — the body `user_id` is ignored entirely.
- Delete returns 204 on success and 404 when the record doesn't exist or belongs to another user.

---

### F06.5 — User Preference Management

**Description:** Allow users to update their language preference and delete their account.

**Tasks:**
- [ ] `PATCH /users/me` (requires `requireAuth`):
  - Allowed fields: `language_pref` (enum: `'en'`, `'es'` only)
  - No other `users` table fields are updatable via this endpoint
- [ ] `DELETE /users/me` (requires `requireAuth`):
  - Soft-delete or hard-delete the user record
  - On delete: CASCADE deletes `saved_searches` (enforced by DB foreign key constraint from F01.1)
  - Invalidate all existing refresh tokens for this user (clear from Redis or add to blocklist)

**Acceptance Criteria:**
- Attempting to update `password_hash` or `role` via `PATCH /users/me` returns 400 (field not allowed).
- After `DELETE /users/me`, all the user's saved searches are gone from the database.
- After account deletion, the user's refresh token is invalidated.

---

## Integration Test Matrix

| Endpoint | Test Scenario | Expected Outcome |
|---|---|---|
| `POST /users/register` | Valid new user | 201, access token in body, refresh token in cookie |
| `POST /users/register` | Duplicate email | 409 |
| `POST /users/login` | Wrong password | 401 (same body as wrong email) |
| `POST /users/login` | 11th attempt in 1 min | 429 |
| `POST /auth/refresh` | Valid cookie | 200, new access token |
| `POST /auth/refresh` | Replayed token | 401 |
| `GET /users/saved-searches` | No auth header | 401 |
| `GET /users/saved-searches` | User A's token | Returns only User A's searches |
| `DELETE /users/saved-searches/:id` | User A deletes User B's search ID | 404 |

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E06 |
|---|---|
| E05 (Core API) | `requireAuth` and `requireRole` middleware |
| E07 (Notifications) | `saved_searches` with `alert_enabled = true` and `score_threshold` |
| E08 (Frontend Web) | All auth endpoints and the JWT-based session pattern |
