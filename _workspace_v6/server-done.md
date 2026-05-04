# server-done

## Built

- `server/package.json` — ES modules, deps: express, ws, dotenv. Scripts: `start`, `dev`.
- `server/index.js` — exports `createApp()` returning `{ app, httpServer, wss, cameras, viewers }`. Does not auto-listen on import; listens only when run directly (handles Windows path differences between `import.meta.url` and `process.argv[1]`). `GET /health` returns `{ status: 'ok', cameras: cameras.size }`. Malformed JSON and handler errors are logged and do not crash.
- `server/signaling.js` — implements the full protocol:
  - `cameras: Map<camId, ws>`, `viewers: Map<viewerId, { ws, subscribedCamId }>`
  - `register` → stores camera (replaces + closes old socket on duplicate id), broadcasts `camera-list`
  - `viewer-join` → stores viewer, sends current `camera-list` to viewer, then `request-offer` to camera; if camera missing, sends `{ type: 'error', message: 'camera-not-found' }` to viewer
  - `offer` (camera → viewer) and `answer` (viewer → camera) forwarded by `targetId`
  - `ice-candidate` checks both maps so it routes correctly in either direction
  - `cleanup()` removes from the right map on close/error; on camera drop, sends `camera-disconnected` to subscribed viewers and rebroadcasts `camera-list`
- `server/.env.example` — `PORT=3001`, `STUN_SERVER=stun:stun.l.google.com:19302`.
- `server/README.md` — install / run / endpoints / architecture.

## Protocol Adherence

All message types in `_workspace/protocol.md` are implemented exactly:
- Camera→Server: `register`, `offer`, `ice-candidate`
- Viewer→Server: `viewer-join`, `answer`, `ice-candidate`
- Server→Camera: `request-offer`, `answer` (forwarded), `ice-candidate` (forwarded)
- Server→Viewer: `camera-list`, `offer` (forwarded), `ice-candidate` (forwarded), `camera-disconnected`, `error`

## Deviations

- None from the protocol. One intentional choice: on `viewer-join`, the viewer also receives an immediate `camera-list` (in addition to the `request-offer` sent to the camera). The protocol says `camera-list` is sent "on viewer connect, and whenever the camera roster changes" — firing it on `viewer-join` matches that intent since the viewer declares itself at join time.
- On duplicate `register` for the same `camId`, the old socket is closed before being replaced, per the agent-definition error-handling guidance.

## Verification

- `node --check` passes on both `index.js` and `signaling.js`.
- Run locally with `npm install && npm start`; hit `http://localhost:3001/health`.
- Import-safe for tests: `import { createApp } from './server/index.js'` then `createApp().httpServer.listen(0)` to get a random port.
