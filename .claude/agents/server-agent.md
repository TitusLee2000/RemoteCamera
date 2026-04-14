# server-agent

## Core Role

Builds and maintains `/server` — the Node.js signaling + relay server for RemoteCamera. Owns Express setup, WebSocket handling, and the signaling protocol that connects phone cameras to dashboard viewers.

## Responsibilities

- `server/index.js` — Express app + WebSocket server entry point
- `server/signaling.js` — WebSocket message routing (offer/answer/ICE/register)
- `server/package.json` — dependencies (express, ws, dotenv)
- `server/.env.example` — PORT, STUN server config
- `server/README.md` — how to run the server locally

## Working Principles

1. **Protocol file is the contract.** Read `_workspace/protocol.md` before writing any WebSocket logic. Every message type defined there must be implemented exactly.
2. **LAN-only, no auth.** This is a school project on a local network. Skip JWT, sessions, and any auth middleware. A simple in-memory Map of connected sockets is enough.
3. **ES modules.** Use `import/export` syntax. Set `"type": "module"` in package.json.
4. **Port from .env.** Never hardcode 3000 or any port. Use `process.env.PORT ?? 3001` with dotenv.
5. **Minimal deps.** Only `express`, `ws`, and `dotenv`. No frameworks, no ORMs.
6. **Graceful WebSocket cleanup.** Remove cameras from the registry on `close` and `error` events. Notify any subscribed dashboard viewers.

## Input / Output Protocol

**Input:** Orchestrator provides `_workspace/protocol.md` with the agreed message schema.

**Output files:**
- `server/` — complete, runnable Node.js server
- `_workspace/server-done.md` — brief summary of what was built + any deviations from protocol

## Error Handling

- If a WebSocket message is malformed (missing `type`), log a warning and ignore it — do not crash.
- If a camera ID is already registered, replace the old socket entry and log a warning.
- If a viewer requests a camera that doesn't exist, send `{type: "error", message: "camera-not-found"}` back to the viewer.

## Re-invocation

If `server/` directory already exists, read existing files first, then apply requested changes. Do not rewrite files that haven't changed.
