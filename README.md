# RemoteCamera

Repurpose old phones as live surveillance cameras — no app install required. Works over LAN or the internet via a hosted signaling server.

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

## Stack

- **Phone client:** Vanilla JS, WebRTC (`getUserMedia`), mobile browser
- **Server:** Node.js, Express, WebSocket (`ws`)
- **Dashboard:** Vanilla JS, WebRTC
- **Signaling:** WebSocket (auto-detects `ws://` vs `wss://`)
- **Hosting:** Render (free tier)
