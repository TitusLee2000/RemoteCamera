# Dashboard — Done

## Files Created
- `dashboard/index.html` — App shell with header, banner, camera grid, empty state, and a `<template>` for camera cards.
- `dashboard/app.js` — WebSocket signaling + WebRTC answerer logic.
- `dashboard/style.css` — Dark surveillance dashboard, mobile-first responsive grid.

## Configuration (top of `app.js`)
```js
const SERVER_URL = 'ws://localhost:3001';
const STUN_SERVER = 'stun:stun.l.google.com:19302';
```

## Protocol Conformance
Implements exactly the message types in `_workspace/protocol.md`:

**Sends:**
- `viewer-join` — `{ type, camId, viewerId }`
- `answer` — `{ type, answer, camId, targetId: camId, viewerId }`
- `ice-candidate` — `{ type, candidate, viewerId, targetId: camId }`

**Receives:**
- `camera-list` — populates / refreshes camera cards
- `camera-disconnected` — marks card offline (does not remove)
- `offer` — drives `handleOffer()` (answerer flow)
- `ice-candidate` — added to the matching `RTCPeerConnection`
- `error` — logged

No additional message types are emitted.

## WebRTC Flow (Answerer)
1. User clicks **View** → `viewer-join` sent → status = `connecting`
2. Server forwards camera's `offer` → `setRemoteDescription` → `createAnswer` → `setLocalDescription` → `answer` sent
3. ICE candidates exchanged via `ice-candidate` messages (each side targets the other)
4. `ontrack` → attach `streams[0]` to `<video>` → status = `live`
5. On `camera-disconnected` or PC failure → status = `offline` / `error`, peer connection closed

## State Model
```js
const cameras = {} // camId -> { status: 'idle'|'connecting'|'live'|'offline'|'error', pc: RTCPeerConnection|null }
```

## UI/UX Highlights (ui-ux-pro-max, dashboard product type)
- **Dark theme** tuned for dim rooms; text contrast ≥ 9:1 against background.
- **Status badges** with redundant icon + color + text (Idle / Connecting / Live / Offline / Error). Live and Connecting badges pulse.
- **Touch targets** ≥ 44×44px on all buttons. `touch-action: manipulation`.
- **Keyboard accessible**: skip link, visible 3px focus ring, semantic landmarks (`<header>`, `<main>`, `<section>`, `<article>`).
- **Responsive grid** via CSS Grid: 1 col < 640px, 2 cols ≥ 640px, 3 cols ≥ 1024px, 4 cols ≥ 1400px. No horizontal scroll.
- **Loading state**: spinner overlay shown while `connecting`; live overlay hidden once stream attaches.
- **Empty state**: "No cameras connected yet — open the phone client on a phone to get started."
- **Error banner**: "Cannot connect to server. Retrying…" shown on WebSocket failure, with auto-reconnect (exponential backoff up to 10 s).
- **Fullscreen button** per live feed using `requestFullscreen` with `webkit*`/`ms*` and iOS `webkitEnterFullscreen` fallbacks.
- **Reduced-motion** respected via `@media (prefers-reduced-motion: reduce)`.
- `<video autoplay muted playsinline>` per requirements.

## Resilience
- Auto-reconnect to WebSocket with exponential backoff.
- All active peer connections marked offline if the signaling socket drops.
- Per-card **Retry** button on error; **Reconnect** placeholder when offline (re-enabled when camera reappears in `camera-list`).
- `addIceCandidate` and offer/answer wrapped in try/catch — failures surfaced as the `error` card state.

## Known Limitations
- No TURN server configured — relies on STUN only; cross-NAT scenarios outside a LAN may fail.
- No authentication on the signaling channel (school project scope).
- Single audio/video stream per camera; multi-track or data channels not handled.
- "Reconnect" button on offline cards stays disabled until the server re-advertises the camera in a new `camera-list`.
- No persistence — refreshing the page resets all view sessions.
