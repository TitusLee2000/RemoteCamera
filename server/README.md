# RemoteCamera Signaling Server

Node.js + Express + WebSocket relay that brokers WebRTC offers/answers/ICE between phone cameras and dashboard viewers on a LAN.

The server never touches media — it only routes signaling JSON. Video flows peer-to-peer once WebRTC is established.

## Install

```bash
cd server
npm install
cp .env.example .env
```

## Run

```bash
npm start
```

For auto-reload during development:

```bash
npm run dev
```

Default port is `3001`. Override via `.env`:

```
PORT=3001
STUN_SERVER=stun:stun.l.google.com:19302
```

## Endpoints

- `GET /health` → `{ "status": "ok", "cameras": <count> }`
- `ws://<host>:<port>/` — WebSocket signaling endpoint (see `_workspace/protocol.md` for message schema).

## Architecture

- `index.js` — Express app + HTTP server + WebSocket server. Exports `createApp()` factory so tests can bind to a random port. Auto-listens only when run directly.
- `signaling.js` — message routing. Keeps two in-memory maps:
  - `cameras: camId → WebSocket`
  - `viewers: viewerId → { ws, subscribedCamId }`

On camera register, viewers receive an updated `camera-list`. On viewer `viewer-join`, the target camera receives a `request-offer` (or the viewer gets `{ type: "error", message: "camera-not-found" }` if the camera isn't registered). Offers, answers, and ICE candidates are forwarded by `targetId`.

On disconnect, the socket is removed from its registry; if it was a camera, every subscribed viewer gets `camera-disconnected` and the roster is rebroadcast.

## LAN usage

Find the machine's LAN IP (e.g., `192.168.1.42`). Phones open the client at that IP, dashboard opens there too. All three (camera, viewer, server) must be on the same network.

## Notes

- No auth — LAN school project only.
- ES modules (`"type": "module"`).
- Minimal deps: `express`, `ws`, `dotenv`.
