# Phone Client — Done

## Files
- `client/index.html` — single-page shell, mobile viewport meta, links app.js / style.css
- `client/app.js` — config constants, camId generation, getUserMedia, WebSocket signaling, WebRTC offerer flow
- `client/style.css` — mobile-first dark UI, big tap targets, portrait layout

## Config (top of app.js)
```js
const SERVER_URL  = 'ws://localhost:3001';            // change to your LAN IP / wss:// URL
const STUN_SERVER = 'stun:stun.l.google.com:19302';   // public Google STUN
```

## Behaviour
1. Page load generates `camId = Math.random().toString(36).slice(2, 8)` and shows it big on screen.
2. User taps **Start Streaming** (a real user gesture — required by Safari for `getUserMedia`).
3. Camera permission requested with `{ video: { facingMode: 'environment' }, audio: false }`. Denial shows a visible red error box.
4. WebSocket opens to `SERVER_URL`; on `open`, sends `{ type: 'register', camId }`.
5. When server sends `{ type: 'request-offer', viewerId }` the client:
   - Creates `RTCPeerConnection` with the STUN server
   - Adds local tracks
   - `createOffer` → `setLocalDescription` → sends `{ type: 'offer', offer, camId, targetId: viewerId }`
   - Trickles `ice-candidate` messages with the same `targetId`
6. On `answer` → `setRemoteDescription`, flushes any buffered remote ICE candidates.
7. On incoming `ice-candidate`, adds it (or buffers it if remote description not yet set).
8. Status pill cycles: `idle → connecting → live → error`.
9. **Stop** button tears down the peer connection, closes the WebSocket, and stops the camera tracks.

## Protocol Conformance
Only the message types defined in `_workspace/protocol.md` are sent or handled:
- Sends: `register`, `offer`, `ice-candidate`
- Handles: `request-offer`, `answer`, `ice-candidate`
No invented message types.

## Safari / Mobile Considerations
- `<video playsinline muted autoplay>` so iOS Safari does not fullscreen the preview.
- `getUserMedia` is called only inside the click handler, never on page load.
- A note in the UI tells iOS users they need HTTPS; Android/Chrome works over plain http:// on LAN.
- `viewport-fit=cover` and `theme-color` set for a clean phone look.
- `pagehide` listener tears down media tracks so the camera light turns off when the tab is closed.

## Error Surfaces (all visible, not just console)
- Camera permission denied / no camera → red error box with guidance to re-enable in browser settings.
- WebSocket constructor throws or `error` event fires → "Cannot connect to server — check the URL (...)".
- WebSocket closes mid-session → "Connection to server lost. Tap Stop and try again."
- `RTCPeerConnection.connectionState === 'failed'` → "Stream failed — please refresh."
- Offer / `setRemoteDescription` exceptions → human-readable error in the box.

## Known Quirks
- iOS Safari only grants `getUserMedia` over HTTPS (or `localhost` on the device itself, which is not useful for a phone client). Use a self-signed cert + `wss://` for LAN testing on iPhone.
- Some Android browsers require the page to remain in the foreground for the stream to keep flowing. Lock-screen will pause it.
- If the LAN blocks UDP between peers, only STUN is configured — add a TURN server to `iceServers` for those networks.
- One reconnect on ICE failure is not implemented as an automatic retry; the user is told to refresh, which is the simpler, more reliable UX for a school-project demo.
