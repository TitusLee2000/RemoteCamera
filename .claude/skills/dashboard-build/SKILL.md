---
name: dashboard-build
description: "Builds the RemoteCamera dashboard in /dashboard — the viewer web app that shows live camera feeds. Use when implementing or modifying the dashboard HTML/JS, WebRTC viewer, camera grid, or stream management UI. Triggered by: 'build the dashboard', 'fix the viewer', 'dashboard is broken', 'can't see the streams', 'update dashboard', 'dashboard changes', 'viewer page'."
---

# Dashboard Build Skill

Guides the dashboard-agent in building a browser-based viewer for live RemoteCamera streams.

## UI/UX Baseline

Before writing any HTML/CSS, read the global `ui-ux-pro-max` skill. Apply it for the **"dashboard" product type** on the **HTML/CSS stack**. Non-negotiable minimum:

- All interactive elements ≥ 44×44px touch targets
- Color contrast ≥ 4.5:1 (camera status badges, button labels)
- Keyboard navigable (Tab to camera cards, Enter to view)
- Mobile-first CSS breakpoints: 1-column below 640px, 2-column above
- No horizontal scroll at any viewport width
- Loading states for connecting streams (skeleton or spinner, not blank)

The dashboard will be used on a laptop in a dimly lit room watching surveillance feeds — prioritize legibility (high contrast, clear status indicators) over decoration.

## What to Build

```
dashboard/
├── index.html    (app shell)
├── app.js        (WebSocket + WebRTC viewer logic)
└── style.css     (camera grid layout)
```

## WebRTC Flow (Dashboard / Answerer Role)

The dashboard is always the **answerer**. It receives an offer from the camera (routed through the server) and responds:

```js
async function handleOffer(offer, camId, viewerId) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVER }] })
  peerConnections.set(camId, pc)

  pc.ontrack = ({ streams }) => {
    const video = document.getElementById(`video-${camId}`)
    video.srcObject = streams[0]
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) ws.send(JSON.stringify({
      type: 'ice-candidate',
      candidate,
      targetId: camId,
      viewerId
    }))
  }

  await pc.setRemoteDescription(offer)
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  
  ws.send(JSON.stringify({ type: 'answer', answer, camId, targetId: camId, viewerId }))
}
```

## WebSocket Message Handling

Read `_workspace/protocol.md` for the full schema. The key messages the dashboard sends/receives:

| Direction | Message type | When |
|-----------|-------------|------|
| Send | `viewer-join` | User clicks "View" on a camera card |
| Send | `answer` | After creating WebRTC answer |
| Send | `ice-candidate` | ICE candidates for the camera |
| Receive | `camera-list` | On connect — list of available cameras |
| Receive | `camera-disconnected` | Camera left |
| Receive | `offer` | WebRTC offer from camera (via server) |
| Receive | `ice-candidate` | ICE candidates from camera |

## UI Layout

```
RemoteCamera Dashboard
━━━━━━━━━━━━━━━━━━━━━
Connected Cameras:

┌──────────┐  ┌──────────┐
│ cam-abc  │  │ cam-xyz  │
│ [video]  │  │ [video]  │
│  ●Live   │  │  View    │
└──────────┘  └──────────┘

No cameras? → "Open the phone client on a phone to get started."
```

- Each camera card shows its ID
- "View" button triggers `viewer-join` → starts WebRTC negotiation
- Once live, show a live indicator and the video stream
- On disconnect, card shows "Offline" state (do not remove the card)

## State Management

Keep a simple JS object per camera:
```js
const cameras = {}  // camId → { status: 'idle'|'connecting'|'live'|'offline', pc: RTCPeerConnection }
```

On `camera-disconnected`: set status to `offline`, close the RTCPeerConnection, update the UI.
On `viewer-join` sent: set status to `connecting`.
On `ontrack` event: set status to `live`.

## Config

At the top of `app.js`:
```js
// Change this to your server's IP address on the local network
const SERVER_URL = 'ws://localhost:3001'
const STUN_SERVER = 'stun:stun.l.google.com:19302'
```

## Protocol Reference

Always read `_workspace/protocol.md` before implementing any WebSocket message handlers.
