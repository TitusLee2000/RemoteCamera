# RemoteCamera v7 — Integration Report

## Status: Complete

All v7 AI & Smart Detection features are implemented across all three layers.

---

## Files Created

### Server
- `server/db/migrations/003_alerts.sql` — alert_rules, push_subscriptions, alert_log tables (UUID FKs)
- `server/services/alert-service.js` — detection pipeline: filter → cooldown check → log → push → email
- `server/services/push-service.js` — web-push VAPID wrapper, stale-subscription cleanup
- `server/services/email-service.js` — nodemailer SMTP wrapper, graceful no-op if unconfigured
- `server/routes/alerts.js` — GET /api/alerts/rules, PUT /api/alerts/rules/:slotId, GET /api/alerts/log
- `server/routes/notifications.js` — VAPID key endpoint, subscribe, unsubscribe

### Dashboard
- `dashboard/sw.js` — service worker for Web Push notification display

### Workspace
- `_workspace/v7-protocol.md` — feature contract
- `_workspace/server-v7-done.md` — server implementation report

---

## Files Modified

### Server
- `server/index.js` — registered /api/alerts and /api/notifications routers
- `server/signaling.js` — detection-event handler: calls alert-service + forwards to viewers
- `server/package.json` — added web-push, nodemailer
- `server/.env.example` — added VAPID_*, SMTP_* vars

### Client (phone)
- `client/index.html` — TF.js CDN scripts, AI controls UI, hidden canvas, overlay canvas
- `client/app.js` — full detection pipeline: loadDetectionModel, startObjectDetection, 
  runDetectionTick, drawDetectionOverlay, detection-event WebSocket message
- `client/style.css` — AI status, detected list, overlay canvas styles

### Dashboard
- `dashboard/index.html` — alert log section, alert config modal, detection overlay div, 
  Alerts button on camera card template
- `dashboard/app.js` — handleDetectionEvent, openAlertConfig, alert modal save/close, 
  push subscription setup, loadAlertLog, service worker registration, Alerts button wiring
- `dashboard/style.css` — detection overlay, detection badges (person/vehicle/animal), 
  alert config modal styles

---

## What Works

- Phone runs TF.js COCO-SSD at configurable interval (1–10s, default 2s)
- Detections shown as bounding boxes on phone preview with class + confidence
- Detected classes shown in AI status panel on phone
- Detection events sent to server via WebSocket (only when streaming + registered)
- Server routes to viewers → dashboard shows detection badge overlay on camera card
- Dashboard overlay fades after 3s per card
- Alert rules configurable per slot: enabled toggle, object classes, confidence, cooldown, push, email
- Alert log table auto-refreshes every 30s, shows push/email delivery status
- Push notification flow: SW registration → permission → VAPID key fetch → subscribe → POST to server
- Email alerts via SMTP when configured

## What Needs Manual Setup

1. **VAPID keys** — run once: `npx web-push generate-vapid-keys`
   Add to server `.env`:
   ```
   VAPID_PUBLIC_KEY=<publicKey>
   VAPID_PRIVATE_KEY=<privateKey>
   VAPID_SUBJECT=mailto:admin@example.com
   ```

2. **SMTP** (optional) — add to server `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=you@gmail.com
   SMTP_PASS=your-app-password
   SMTP_FROM=RemoteCamera <noreply@example.com>
   ```

## Known Issues / Deviations

1. Push fan-out goes to admin/operator subscribers only — viewers have no persisted user→slot mapping
2. TF.js CDN scripts require internet on first load (model is ~29MB); subsequent loads use browser cache
3. Pre-existing test failure: `npm test` fails because signaling.test.js loads storage.js which requires SUPABASE_URL — unrelated to v7
