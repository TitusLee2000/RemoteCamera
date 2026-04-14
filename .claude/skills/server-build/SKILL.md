---
name: server-build
description: "Builds the RemoteCamera Node.js signaling server in /server. Use when implementing or modifying the Express/WebSocket server, signaling logic, camera registry, or server package.json. Triggered by: 'build the server', 'fix the signaling', 'server is broken', 'add a new message type to the server', 'update server', 'server changes'."
---

# Server Build Skill

Guides the server-agent in building a complete, runnable Node.js signaling server for RemoteCamera.

## What to Build

```
server/
├── package.json      (type: module, deps: express ws dotenv)
├── index.js          (entry point — Express + WS server)
├── signaling.js      (WebSocket message routing logic)
├── .env.example      (PORT=3001, STUN_SERVER=stun:stun.l.google.com:19302)
└── README.md         (run instructions)
```

## Signaling Architecture

The server is a pure relay — it does not participate in WebRTC. It maintains two registries:

```js
const cameras = new Map()    // camId → WebSocket
const viewers = new Map()    // viewerId → { ws, subscribedCamId }
```

**Message routing rules:**
- `register` from camera → store in `cameras`, broadcast updated `camera-list` to all viewers
- `viewer-join` from viewer → store in `viewers`, trigger `request-offer` to the camera
- `offer` from camera → forward to the target viewer (found via `viewers`)
- `answer` from viewer → forward to the target camera (found via `cameras`)
- `ice-candidate` from either → forward to the other party

On WebSocket `close`/`error`: remove from the appropriate registry. If a camera disconnects, send `camera-disconnected` to all its viewers.

## WebSocket Server Setup

```js
import { WebSocketServer } from 'ws'
import { createServer } from 'http'

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer })

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg
    try { msg = JSON.parse(raw) } catch { return }
    handleMessage(ws, msg)
  })
  ws.on('close', () => cleanup(ws))
  ws.on('error', () => cleanup(ws))
})
```

## Protocol Reference

Always read `_workspace/protocol.md` for the authoritative message schema. The file is written by the orchestrator before agents are invoked.

## Health Check

Add `GET /health` → `{status: 'ok', cameras: cameras.size}`. Useful for debugging on LAN.

## Serving Static Files (Optional)

If asked, the server can also serve the `client/` and `dashboard/` directories as static files. Add:
```js
app.use('/client', express.static('../client'))
app.use('/dashboard', express.static('../dashboard'))
```
But this is not required for v1 — phones can open `index.html` directly via file:// or a separate simple server.
