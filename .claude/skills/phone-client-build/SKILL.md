---
name: phone-client-build
description: "Builds the RemoteCamera phone client in /client — the mobile browser app that captures camera video and streams it via WebRTC. Use when implementing or modifying the phone-side HTML/JS, getUserMedia setup, WebRTC peer connection, or mobile UI. Triggered by: 'build the phone client', 'fix the camera page', 'phone client is broken', 'the camera won't stream', 'update client', 'client changes', 'mobile camera page'."
---

# Phone Client Build Skill

Guides the phone-client-agent in building a mobile-friendly, no-install camera streamer that works in Safari and Chrome.

## What to Build

```
client/
├── index.html    (app shell + inline or linked JS/CSS)
├── app.js        (WebRTC + WebSocket logic)
└── style.css     (mobile-first layout)
```

## Critical Safari Constraints

Safari is the hardest browser to support. These are non-negotiable:

1. `<video playsinline>` — without `playsinline`, Safari will fullscreen the video
2. `getUserMedia` must be called from inside a user gesture handler (button click), not on `DOMContentLoaded`
3. Use `navigator.mediaDevices.getUserMedia` — the old `navigator.getUserMedia` is deprecated
4. HTTPS or localhost required for `getUserMedia` — on LAN, `localhost` on the phone itself won't work. The user must either use HTTPS or Chrome (which allows `getUserMedia` on LAN IP)

Add a visible note in the UI: "On iPhone/Safari: camera requires HTTPS. On Android/Chrome: http:// works on local network."

## WebRTC Flow (Camera / Offerer Role)

The phone is always the **offerer**:

```js
async function startStreaming(stream) {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVER }] })
  
  stream.getTracks().forEach(track => pc.addTrack(track, stream))
  
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) ws.send(JSON.stringify({
      type: 'ice-candidate',
      candidate,
      targetId: viewerId,   // set when viewer-join arrives
      camId
    }))
  }
  
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  
  ws.send(JSON.stringify({ type: 'offer', offer, camId, targetId: viewerId }))
  
  // later: handle 'answer' message → pc.setRemoteDescription(answer)
}
```

## WebSocket Message Handling

Read `_workspace/protocol.md` for the full schema. The key messages the client sends/receives:

| Direction | Message type | When |
|-----------|-------------|------|
| Send | `register` | On WebSocket open |
| Send | `offer` | After creating WebRTC offer |
| Send | `ice-candidate` | As ICE candidates trickle in |
| Receive | `viewer-join` | A dashboard viewer wants to watch |
| Receive | `answer` | Dashboard's WebRTC answer |
| Receive | `ice-candidate` | ICE candidates from dashboard |

## UI Layout

```
┌──────────────────┐
│  RemoteCamera    │
│  Camera ID: abc123  │
│                  │
│  [video preview] │
│                  │
│  [Start Streaming] │
│  Status: idle    │
└──────────────────┘
```

- Camera ID displayed prominently (user reads it aloud to the dashboard operator)
- Video preview shows what's being captured (muted, playsinline)
- Status line: idle → connecting → live → error

## Config

At the top of `app.js`:
```js
// Change this to your server's IP address on the local network
const SERVER_URL = 'ws://localhost:3001'
const STUN_SERVER = 'stun:stun.l.google.com:19302'
```

## Protocol Reference

Always read `_workspace/protocol.md` before implementing WebSocket message handlers.
