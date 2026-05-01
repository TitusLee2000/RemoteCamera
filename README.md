# RemoteCamera

Repurpose old phones as live surveillance cameras — no app install required. Works over LAN or the internet via a hosted signaling server.

---

## Version History

### Version 2 — Hosting + Features ✅
**Goal:** Deploy to the internet and add quality-of-life features.

**Features added:**
- **Render hosting** — deployed to `remotecamera-1.onrender.com` with automatic HTTPS
- **WAN streaming** — TURN relay via Open Relay (`openrelay.metered.ca`) enables streaming across different networks, not just LAN
- **Dynamic connection** — `SERVER_URL` and ICE servers auto-detected at runtime; no manual config needed for LAN or production
- **Screen Lock / Touch Protection** — phone client lock button activates a black overlay (simulates screen off), Wake Lock API keeps the device awake, swipe up or drag up ≥60px to unlock; ✕ button as desktop fallback
- **Remote Dim** — dashboard can remotely dim/undim any connected camera; dim state is synced across all viewers in real time
- **Camera card collapse** — dashboard cards can be collapsed to save screen space; dimmed badge acts as dim toggle in collapsed state
- **Graceful disconnect** — cameras that drop briefly stay visible for 5 seconds before their card is removed, preventing flicker on WebSocket blips
- **iOS/Android WebRTC fixes** — switched to `iceConnectionState` as primary signal (more reliable on iOS WebKit); ICE candidate buffering before remote description is set

**Known issues:**
- Open Relay is a public free TURN server shared by many users — can be slow or unreliable under load; not suitable for long-term production use
- Render free tier sleeps after 15 minutes of inactivity (~30s cold start)
- Only one viewer can watch a camera at a time (single viewer per camera session)
- No authentication — anyone with the URL can view cameras

**Next recommended actions (Version 3):**
- Replace Open Relay with a private TURN server (self-host `coturn`, or fix Metered.ca API key issue)
- Support multiple simultaneous viewers per camera
- Add basic authentication (PIN or token) to restrict dashboard access
- Camera name labels — let users name their cameras instead of random IDs
- Persist camera IDs across page refreshes (localStorage) so the same phone always shows the same ID

---

### Version 5 — Auth + Cloud Database ✅
**Goal:** Secure the app with login and persist data in PostgreSQL on Render.

**Features added:**
- **Login page** — email/password auth via Passport.js; session stored in PostgreSQL (`connect-pg-simple`)
- **First-run setup** — no users in DB → setup page creates the first admin account
- **Self-registration** — new users can create their own accounts (operator role by default)
- **Role-based access** — three roles: `admin`, `operator`, `viewer`; admin bypasses all role checks
- **Camera slot system** — admin/operator creates named slots with nanoid codes; cameras authenticate using `?slot=CODE` in the URL
- **User management panel** — admin can create/delete users from the dashboard
- **PostgreSQL on Render** — all data (users, slots, sessions, recordings) persisted in a managed Postgres instance
- **WebSocket heartbeat** — server pings all clients every 25s to keep connections alive on Render free tier
- **Trust proxy** — `app.set('trust proxy', 1)` enabled for correct cookie behavior behind Render's proxy

**Known issues:**
- Dashboard slots/users tables may not display data on first load — see **Troubleshooting** below

---

### Version 4 — Motion Detection + Recording ✅
Local recording with motion detection, auto-record on motion, and a recordings table in the dashboard.

---

### Version 3 — Multi-viewer + TURN ✅
Multiple simultaneous viewers per camera, private TURN server support via Metered.ca.

---

### Version 1–2 — LAN MVP → Hosted ✅
Core WebRTC camera streaming over a local network. Phone client captures video, dashboard views it, WebSocket server handles signaling.

## Live Demo

| URL | Purpose |
|-----|---------|
| https://remotecamera-1.onrender.com/client | Phone camera page |
| https://remotecamera-1.onrender.com/dashboard | Viewer dashboard |
| https://remotecamera-1.onrender.com/health | Server health check |

> The free Render tier sleeps after 15 min of inactivity. Open the dashboard first and wait ~30 seconds if it doesn't connect immediately.

---

## How to Test (No Setup Required)

1. **Open the dashboard** on your computer:
   `https://remotecamera-1.onrender.com/dashboard`

2. **Open the phone client** on your phone's browser:
   `https://remotecamera-1.onrender.com/client`

3. **Allow camera access** when prompted on the phone

4. The phone should appear in the dashboard — click it to start the live stream

Works on Android Chrome and iPhone Safari (HTTPS is already handled by Render).

---

## Run Locally (LAN)

### Step 1 — Start the server

```bash
cd server
npm install
node index.js
```

### Step 2 — Find your LAN IP (Windows)

```bash
ipconfig
```

Look for "IPv4 Address" under your WiFi adapter, e.g. `192.168.1.42`

### Step 3 — Open on your phone

```
http://192.168.1.42:3001/client
```

### Step 4 — Open the dashboard

```
http://192.168.1.42:3001/dashboard
```

The `SERVER_URL` is now auto-detected — no manual config needed.

> **Android:** Works over plain `http://` on LAN.  
> **iPhone Safari:** Requires HTTPS for camera access. Use the hosted URL above, or set up a local HTTPS proxy.

---

## Run Tests

```bash
cd server
npm test
```

13 tests covering WebSocket signaling — camera registration, viewer join, offer/answer relay, ICE candidate exchange, and disconnect cleanup.

---

## Project Structure

```
/client       Phone camera page (vanilla JS, WebRTC)
/dashboard    Viewer dashboard (vanilla JS, WebRTC)
/server       Node.js signaling server (Express + WebSocket)
  index.js    Entry point
  signaling.js  Camera registry and message routing
  test/       Test suite
```

---

## Next Steps — Version 6 (Cloud Storage)

Move recordings from local disk (lost on Render redeploy) to cloud object storage.

**Recommended provider:** Cloudflare R2 (S3-compatible, free egress)

**Recommended upload flow:** Server as middleman — camera uploads to server, server streams to R2. Simpler auth, no CORS issues.

**Tasks:**
- [ ] Provision R2 bucket and generate API credentials
- [ ] Add `@aws-sdk/client-s3` to server dependencies (S3-compatible)
- [ ] Update `/api/recordings/upload` to stream file to R2 instead of local disk
- [ ] Update download endpoint to redirect to R2 signed URLs
- [ ] Remove local `recordings/` directory dependency

---

## Troubleshooting

### Dashboard slots/users tables show no data

Open the browser console on the dashboard and run:

```js
fetch('/api/users').then(r => r.json()).then(console.log)
fetch('/api/slots').then(r => r.json()).then(console.log)
```

- **401** → session is not persisting; check `SESSION_SECRET` and `NODE_ENV=production` in Render environment variables
- **403** → logged-in user's role is not `admin`/`operator`; check role in DB with `node scripts/check-slots.js`
- **Empty array `[]`** → no data in DB yet; create a slot or check that first-run setup completed
- **Data returned** → rendering bug; open an issue

---

## Stack

- **Phone client:** Vanilla JS, WebRTC (`getUserMedia`), mobile browser
- **Server:** Node.js, Express, WebSocket (`ws`)
- **Dashboard:** Vanilla JS, WebRTC
- **Signaling:** WebSocket (auto-detects `ws://` vs `wss://`)
- **Hosting:** Render (free tier)
