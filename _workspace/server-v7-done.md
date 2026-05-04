# Server v7 — AI & Smart Detection — Implementation Report

## Summary
All v7 server-side features implemented per `_workspace/v7-protocol.md`. The
camera-side `detection-event` WebSocket message now triggers DB-backed alert
processing (cooldown, push, email) and is forwarded to all subscribed
viewers for dashboard overlay rendering. Three new tables, two new REST
routers, and three new service modules were added; existing v1–v6 behavior
is unchanged.

## Files created
- `server/db/migrations/003_alerts.sql` — `alert_rules`, `push_subscriptions`, `alert_log` tables
- `server/services/alert-service.js` — detection event pipeline (filter, cooldown, dispatch)
- `server/services/push-service.js` — Web Push (VAPID) wrapper, stale-subscription cleanup
- `server/services/email-service.js` — nodemailer SMTP wrapper, no-op when SMTP unset
- `server/routes/alerts.js` — `GET /api/alerts/rules`, `PUT /api/alerts/rules/:slotId`, `GET /api/alerts/log`
- `server/routes/notifications.js` — `GET /api/notifications/vapid-public-key`, `POST /subscribe`, `DELETE /unsubscribe`

## Files modified
- `server/index.js` — registered `/api/alerts` and `/api/notifications` routers
- `server/signaling.js` — added `detection-event` case + `handleDetectionEvent` (calls alert-service, fans out to subscribed viewers)
- `server/package.json` — added `web-push`, `nodemailer` dependencies
- `server/.env.example` — added VAPID and SMTP variables (v7 — AI Alerts section)

## npm packages added
- `web-push` ^3.6.7
- `nodemailer` ^6.9.14 (npm resolved to 6.10.1)

Installed via `npm install` in `server/`. 14 transitive packages added.

## Deviations from the protocol

### 1. UUID instead of INTEGER for foreign keys
The protocol's SQL specified `INTEGER` for `slot_id` and `user_id`, but the
existing schema (`001_init.sql`) uses `UUID` for both `users.id` and
`camera_slots.id`. Migration 003 uses `UUID` to match. `alert_log.id` and
`push_subscriptions.id` remain `SERIAL` (auto-increment integer) since they
have no protocol requirement otherwise. Indexes added for
`alert_log(slot_id, alerted_at DESC)` and `push_subscriptions(user_id)`
because both are queried that way.

### 2. "Users with access to a slot" is fuzzy in this schema
The protocol describes push fan-out as "users with access to this slot", but
this codebase has no `slot_access` / `user_slots` join table. Access is:
- admin / operator → all slots (implicit role check)
- viewer → bound to a single slot via `req.session.slotId` only — there is
  no persisted user→slot mapping

`sendPushToSlotSubscribers(slotId, payload)` therefore notifies subscribers
who are **admin or operator**. Viewer push delivery would require a new
`user_slots` table and is out of scope for v7. Documented inline in
`push-service.js`.

### 3. Alert rule defaults returned for un-configured slots
`GET /api/alerts/rules` LEFT JOINs `alert_rules` so the dashboard always
gets one entry per accessible slot — slots without a rule come back with
sane defaults (`enabled=false`, `pushEnabled=true`, `minConfidence=0.7`,
etc). This avoids extra round-trips when rendering the config UI.

### 4. Best-effort, fire-and-forget alert pipeline
`handleDetectionEvent` calls `processDetectionEvent(...)` without awaiting
so a slow DB / SMTP / push provider can't back-pressure WebSocket parsing.
All errors inside the pipeline are caught and logged.

### 5. Cooldown lookup uses last `alert_log` row, not last *delivered* alert
The protocol says "if last alert for this slot was within `cooldown_seconds`".
We honor this by checking the most recent `alert_log` row regardless of
`push_sent` / `email_sent`. This matches the natural reading: the cooldown
prevents storing repeated alerts, not just delivering them.

### 6. Email/push graceful degradation
Both services log a warning and silently no-op when their env vars are
missing, so dev environments without SMTP / VAPID still boot and the
detection pipeline still produces `alert_log` rows.

## Issues that need attention

1. **Pre-existing test failure (not v7-related):**
   `npm test` fails because `test/signaling.test.js` indirectly imports
   `storage.js`, which throws if `SUPABASE_URL` is unset. This failure
   reproduces on `main` before any v7 changes — verified via `git stash`
   round-trip. Out of scope here, but worth fixing by lazy-initializing the
   Supabase client or setting test env vars.

2. **VAPID key generation:** `.env.example` lists empty `VAPID_PUBLIC_KEY` /
   `VAPID_PRIVATE_KEY`. Generate once with
   `npx web-push generate-vapid-keys` and paste the values in. Until then,
   `/api/notifications/vapid-public-key` returns `503 Push not configured`
   and `processDetectionEvent` skips the push step.

3. **Viewer push subscriptions are stored but never delivered to** — see
   deviation #2. If/when a per-slot user access model is added, update
   `sendPushToSlotSubscribers` accordingly.

4. **No automated tests for v7 yet.** Recommend adding tests for: rule
   filtering (class match, confidence cutoff), cooldown enforcement, the
   `detection-event` signaling forward, and the upsert behavior of
   `PUT /api/alerts/rules/:slotId`. These were not in the task brief but
   would be the next logical step.

5. **Dashboard service worker (`dashboard/sw.js`) is required for the
   browser to receive push messages.** That's the dashboard-agent's job per
   the protocol, but flagging it here so it doesn't get missed during
   integration.
