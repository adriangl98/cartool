# E07 — Notification Service

**Phase:** Phase 3 (Weeks 10–11)  
**Goal:** Send push and email alerts to users when a watched vehicle category hits or exceeds their saved Deal Score threshold.  
**Spec Reference:** §2.2 (Notification Service responsibilities), §7 (`POST /users/saved-searches` with `alert_enabled`)  
**Depends On:** E06 (F06.4 — `saved_searches` with `alert_enabled` and `score_threshold`), E05 (listings data)

---

## Features

### F07.1 — Alert Evaluation Worker

**Description:** A BullMQ worker that periodically checks newly scored listings against all active saved searches with `alert_enabled = true`.

**Tasks:**
- [ ] Create `AlertEvaluationWorker` that runs after every scrape cycle completes (triggered via a `notifications-jobs` BullMQ queue event)
- [ ] Query all `saved_searches WHERE alert_enabled = TRUE`
- [ ] For each saved search, query `listings` for vehicles matching the saved filter criteria (make, transaction type, max monthly) that have `deal_score >= score_threshold`
- [ ] For each match: check whether a notification for this `(user_id, listing_id)` pair has already been sent in the last 24 hours (store in Redis with a TTL key to prevent duplicates)
- [ ] If new match found: enqueue a `send-alert` job with `{ userId, listingId, dealScore, vehicleSummary }`

**Acceptance Criteria:**
- The worker does not re-send the same alert for the same listing within a 24-hour window (idempotency test with mocked Redis).
- A user with `score_threshold = 80` receives an alert for a listing with `deal_score = 82` but not one with `deal_score = 79`.
- The evaluation query is parameterized — no string-built SQL from saved search fields.

---

### F07.2 — Email Alert Delivery

**Description:** Send a formatted HTML email when a deal score alert fires.

**Tasks:**
- [ ] Integrate an email provider (AWS SES recommended; configurable via `EMAIL_PROVIDER` env var)
- [ ] Create an HTML email template (bilingual — `en` and `es` versions):
  - Subject: `"New deal alert: [Year Make Model] — Score [X]/100"`
  - Body: vehicle summary card with EMP, Deal Score, dealer name, and a deep link to the listing
- [ ] Implement `sendEmailAlert(userId, listingId)`:
  - Fetch user email from `users` table (using `userId` only — never passed in job payload to prevent tampering)
  - Render the correct language template based on `users.language_pref`
  - Send via the email provider SDK
- [ ] Handle delivery failures: retry up to 3 times, then log to error monitoring and move to dead-letter queue

**Acceptance Criteria:**
- An email is sent to the correct address from the `users` table (not from the job payload).
- The email uses the user's preferred language (`language_pref`).
- Delivery failure after 3 retries moves the job to DLQ and emits a structured error log.

---

### F07.3 — Push Notification Delivery (Mobile)

**Description:** Send a mobile push notification via APNs (iOS) and FCM (Android) when a deal alert fires.

**Tasks:**
- [ ] Add `push_token` field to the `users` table (optional, nullable): `ALTER TABLE users ADD COLUMN push_token TEXT`
- [ ] Create `POST /users/push-token` endpoint (requires `requireAuth`): saves the device push token for the authenticated user
- [ ] Integrate Firebase Cloud Messaging (FCM) for cross-platform delivery
- [ ] `sendPushAlert(userId, listingId)`:
  - Look up `push_token` from `users` table
  - If null: skip silently (user hasn't granted push permissions)
  - Send push notification with `title` and `body` matching the email template content
- [ ] Push token is overwritten on each `POST /users/push-token` call (one active token per user)

**Acceptance Criteria:**
- A user with no `push_token` does not cause an error — alerts silently skip push and still send email.
- A user with a valid FCM token receives the push notification payload in the correct language.
- `POST /users/push-token` requires authentication — unauthenticated request returns 401.

---

### F07.4 — Alert Preference Management

**Description:** Allow users to control alert frequency and opt out entirely from the saved search UI (feeds back to E06).

**Tasks:**
- [ ] Ensure `PATCH /users/saved-searches/:id` (E06 F06.4) supports toggling `alert_enabled` and `score_threshold`
- [ ] When `alert_enabled` is set to `false`, the evaluation worker (F07.1) immediately excludes this saved search from future evaluations (no backlog)
- [ ] Log all sent alerts to a `notification_log` table: `(id, user_id, listing_id, channel: 'email'|'push', sent_at)`
  - Schema migration: write `006_create_notification_log.sql`
  - Used for deduplication (F07.1) and for rendering a "Recent Alerts" list in the UI

**Acceptance Criteria:**
- After setting `alert_enabled = false`, no further alerts are sent for that saved search.
- `notification_log` contains one row per delivered alert per channel.
- Deduplication logic in F07.1 queries `notification_log` rather than keeping only Redis (so it survives a Redis flush).

---

## Dependencies for Downstream Epics

| Downstream Epic | Requires from E07 |
|---|---|
| E08 (Frontend Web) | `POST /users/push-token` endpoint; notification history for "Recent Alerts" UI |
