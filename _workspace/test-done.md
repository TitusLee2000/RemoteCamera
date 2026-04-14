# test-agent — Signaling Server Test Summary

Date: 2026-04-13
Test runner: `node --test` (node:test) with `node:assert/strict`
Test file: `server/test/signaling.test.js`
Script: `npm test` in `server/`

## Result: 13/13 passing, 0 failing

```
ok 1  — camera register stores camera and broadcasts camera-list to connected viewers
ok 2  — duplicate register for same camId closes the old socket and replaces it
ok 3  — viewer-join for existing camera sends camera-list to viewer and request-offer to camera
ok 4  — viewer-join for nonexistent camera sends camera-list then error camera-not-found
ok 5  — offer with valid targetId viewer is forwarded with { offer, camId }
ok 6  — offer with unknown targetId is dropped silently (no crash, no forward)
ok 7  — answer with valid targetId camera is forwarded as { answer, viewerId }
ok 8  — camera ice-candidate with viewer targetId is forwarded to viewer with camId
ok 9  — viewer ice-candidate with camera targetId is forwarded to camera with viewerId
ok 10 — camera disconnect notifies subscribed viewers and rebroadcasts camera-list
ok 11 — viewer disconnect removes viewer from viewers map cleanly
ok 12 — GET /health returns { status: "ok", cameras: 0 } with no cameras
ok 13 — GET /health reflects number of registered cameras
```

## Protocol coverage

Every server-observable behavior in `_workspace/protocol.md` has at least one
automated test:

| Protocol behavior | Test(s) |
|---|---|
| Camera `register` stores & broadcasts | 1 |
| Duplicate register replaces old socket | 2 |
| `viewer-join` on existing camera → `camera-list` + `request-offer` | 3 |
| `viewer-join` on missing camera → `error camera-not-found` | 4 |
| `offer` forwarded with `{ offer, camId }` stripped of targetId | 5 |
| `offer` with bad targetId dropped silently | 6 |
| `answer` forwarded with `{ answer, viewerId }` | 7 |
| Camera ICE → viewer, tagged with camId | 8 |
| Viewer ICE → camera, tagged with viewerId | 9 |
| Camera disconnect: `camera-disconnected` + `camera-list` rebroadcast | 10 |
| Viewer disconnect: removed from viewers map | 11 |
| `GET /health` shape | 12, 13 |

## Server bugs found

None. Implementation matches the protocol spec exactly.

## Implementation notes (test harness)

- Tests spin up a fresh server on port `0` per test via `createApp()` and
  `httpServer.listen(0)`, then close and call `_resetState()` in `afterEach`.
  `_resetState()` is required because `cameras` / `viewers` are module-level
  singletons in `signaling.js` — they survive across `createApp()` instances.
- Each WebSocket client gets a persistent message queue (`attachQueue`) so
  back-to-back sends (e.g. `camera-list` immediately followed by `error`
  on a failed `viewer-join`) are never dropped between awaits. The original
  `ws.once('message', ...)` pattern suggested in the task brief was racy
  for this case — replaced with a queue + waiter list.
- Added `"test": "node --test test/signaling.test.js"` to `server/package.json`.

## Still needs manual / browser testing

These are out of scope for the signaling server tests and require real
browsers + a phone on the LAN:

- `getUserMedia` permission flow on mobile Safari (iOS) and mobile Chrome (Android).
- Actual `RTCPeerConnection` negotiation end-to-end: offer/answer SDP
  exchange and video frames rendering in a `<video>` element.
- ICE candidate gathering over LAN (mDNS candidates on modern browsers,
  host candidates, TURN fallback if used).
- Camera switching (front/back) on the phone client.
- Dashboard UI: camera grid rendering, multiple simultaneous streams,
  reconnect / error UX when a camera disconnects mid-stream.
- Behaviour when the browser backgrounds the tab (iOS Safari pauses
  getUserMedia) — does the signaling server correctly clean up?
- Cross-network edge cases (phone on cellular, viewer on LAN) — currently
  out of scope per "LAN only" constraint.
- Load: many cameras / many viewers at once (registry scaling).
