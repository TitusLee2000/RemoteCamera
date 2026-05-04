# RemoteCamera v7 — AI & Smart Detection Protocol

This document defines all new messages, API endpoints, and database schema for v7.
All existing v1–v6 signaling and recording behavior remains unchanged.

---

## New WebSocket Messages

### Camera → Server

#### `detection-event`
Camera sends AI detection results while streaming.
```json
{
  "type": "detection-event",
  "camId": "abc123",
  "detections": [
    { "class": "person", "score": 0.92, "bbox": [x, y, width, height] }
  ],
  "timestamp": 1714900000000
}
```

### Server → Viewers (broadcast to all viewers watching this camera)

#### `detection-event` (forwarded)
Server forwards detection events to dashboard viewers.
```json
{
  "type": "detection-event",
  "camId": "abc123",
  "detections": [
    { "class": "person", "score": 0.92, "bbox": [x, y, width, height] }
  ],
  "timestamp": 1714900000000
}
```

---

## New REST API Endpoints

All protected by `requireAuth` middleware (existing pattern).

### Alert Rules

#### `GET /api/alerts/rules`
Returns all alert rules for slots the caller can access.
- Admin: all slots
- Operator: their own slots
- Viewer: their accessible slots

Response:
```json
[
  {
    "slotId": 1,
    "slotName": "Front Door",
    "enabled": true,
    "objectClasses": ["person", "car"],
    "minConfidence": 0.7,
    "cooldownSeconds": 60,
    "emailEnabled": false,
    "emailAddress": null,
    "pushEnabled": true
  }
]
```

#### `PUT /api/alerts/rules/:slotId`
Create or update alert rule for a slot.
Body:
```json
{
  "enabled": true,
  "objectClasses": ["person", "car"],
  "minConfidence": 0.7,
  "cooldownSeconds": 60,
  "emailEnabled": false,
  "emailAddress": "user@example.com",
  "pushEnabled": true
}
```

### Push Notifications

#### `POST /api/notifications/subscribe`
Save a browser's push subscription for the authenticated user.
Body: the `PushSubscription` object from the browser's `registration.pushManager.subscribe()`.

#### `DELETE /api/notifications/unsubscribe`
Remove the push subscription for the current user.

#### `GET /api/notifications/vapid-public-key`
Returns the server's VAPID public key (needed by the browser to subscribe).
Response: `{ "publicKey": "..." }`

### Alert Log

#### `GET /api/alerts/log`
Returns recent alert events (last 100).
Query: `?slotId=1` (optional filter)
Response:
```json
[
  {
    "id": 1,
    "slotId": 1,
    "slotName": "Front Door",
    "detectedClass": "person",
    "confidence": 0.92,
    "alertedAt": "2026-05-04T12:00:00Z",
    "pushSent": true,
    "emailSent": false
  }
]
```

---

## Database Schema (new tables in migration 003)

```sql
-- Alert rules per camera slot
CREATE TABLE IF NOT EXISTS alert_rules (
  slot_id          INTEGER PRIMARY KEY REFERENCES camera_slots(id) ON DELETE CASCADE,
  enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  object_classes   TEXT[]  NOT NULL DEFAULT '{}',
  min_confidence   REAL    NOT NULL DEFAULT 0.7,
  cooldown_seconds INTEGER NOT NULL DEFAULT 60,
  email_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  email_address    TEXT,
  push_enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Push subscriptions per user
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint     TEXT NOT NULL UNIQUE,
  p256dh       TEXT NOT NULL,
  auth         TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Alert event log
CREATE TABLE IF NOT EXISTS alert_log (
  id              SERIAL PRIMARY KEY,
  slot_id         INTEGER REFERENCES camera_slots(id) ON DELETE SET NULL,
  detected_class  TEXT NOT NULL,
  confidence      REAL NOT NULL,
  alerted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  push_sent       BOOLEAN NOT NULL DEFAULT FALSE,
  email_sent      BOOLEAN NOT NULL DEFAULT FALSE
);
```

---

## Server Implementation Notes

### New files to create
- `server/routes/alerts.js` — alert rules CRUD + alert log endpoints
- `server/routes/notifications.js` — push subscription management
- `server/services/alert-service.js` — detection event processing, cooldown tracking, notification dispatch
- `server/services/push-service.js` — Web Push (web-push npm package), VAPID key management
- `server/services/email-service.js` — email sending via nodemailer (SMTP)
- `server/db/migrations/003_alerts.sql` — new tables

### Environment variables needed (add to .env.example)
```
# v7 — AI Alerts
VAPID_PUBLIC_KEY=       # generate with web-push generate-vapid-keys
VAPID_PRIVATE_KEY=      # generate with web-push generate-vapid-keys
VAPID_SUBJECT=mailto:admin@example.com

# Email (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=RemoteCamera <noreply@example.com>
```

### Alert processing flow (in alert-service.js)
1. Receive `detection-event` WebSocket message from camera
2. Identify slot for this camera (look up camId → slot)
3. Load alert rule for slot
4. If rule disabled → skip
5. Filter detections by `object_classes` and `min_confidence`
6. If no matching detections → skip
7. Check cooldown: if last alert for this slot was within `cooldown_seconds` → skip
8. Log to `alert_log` table
9. If `push_enabled` → send Web Push to all push subscriptions belonging to users with access to this slot
10. If `email_enabled` → send email to `email_address`
11. Forward detection event to all viewers watching this camera

### VAPID key generation (one-time setup)
Run once during server setup (or at startup if keys not in env):
```js
import webpush from 'web-push'
const keys = webpush.generateVAPIDKeys()
// Save keys.publicKey and keys.privateKey to .env
```

---

## Client Implementation Notes (phone-client-agent)

### TensorFlow.js Integration
Add to `client/index.html`:
```html
<script src="https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@latest/dist/tf.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@latest/dist/coco-ssd.min.js"></script>
```

### Detection pipeline
- Load COCO-SSD model once when streaming starts (async, show loading indicator)
- Sample video frames every 2 seconds using a hidden `<canvas>` element
- Run `model.detect(canvas)` → get detections array
- Send `detection-event` WebSocket message to server
- Show detection overlay on preview video (optional, lightweight)
- Only run detection when `localStream` is active and `pc` is connected

### Detection interval
- Default: 2000ms (configurable via UI slider, range 1000–10000ms)
- Stop detection when streaming stops or tab is hidden (visibilitychange event)

---

## Dashboard Implementation Notes (dashboard-agent)

### New UI sections to add

#### 1. Detection Overlay (per camera card)
- Show detected object labels on camera card when receiving `detection-event`
- Fade out after 3 seconds
- Use colored bounding box labels: person=red, car=blue, animal=green

#### 2. Alert Configuration Panel
- Add "Configure Alerts" button to each camera card
- Opens a modal/panel with:
  - Enable/disable toggle
  - Checkbox list: person, car, truck, bus, motorcycle, bicycle, cat, dog, bird, horse
  - Confidence slider (0.5–1.0)
  - Cooldown input (seconds)
  - Push notifications toggle + "Enable Notifications" button (triggers browser permission)
  - Email toggle + email address input
  - Save button → PUT /api/alerts/rules/:slotId

#### 3. Push Notification Setup
- "Enable Notifications" button: requests permission → subscribes via service worker
- Requires `dashboard/sw.js` service worker file for push event handling
- Push message format: `{ title: "Alert: person detected", body: "Front Door — 92% confidence" }`

#### 4. Alert Log Section
- Add "Alert Log" tab alongside the recordings section
- Table: Timestamp | Camera | Detected | Confidence | Push | Email
- Auto-refreshes every 30 seconds
- Load from GET /api/alerts/log

---

## Object Classes (COCO-SSD subset we care about)
- `person`
- `car`, `truck`, `bus`, `motorcycle`, `bicycle`
- `cat`, `dog`, `bird`, `horse`, `cow`, `sheep`

All other COCO-SSD classes are ignored by default (user can't select them in UI, but
the detection event will still include them — server filters by alert_rules.object_classes).
