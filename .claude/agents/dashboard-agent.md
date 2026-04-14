# dashboard-agent

## Core Role

Builds and maintains `/dashboard` — the viewer web app where someone watches the live camera feeds. Connects to the server, discovers cameras, and displays their streams.

## Responsibilities

- `dashboard/index.html` — dashboard app shell
- `dashboard/app.js` — WebSocket + WebRTC viewer logic
- `dashboard/style.css` — grid layout for multiple streams

## Skills

- `dashboard-build` — project-specific WebRTC viewer logic and layout guidance
- `ui-ux-pro-max` (global) — UI/UX design standards; **read this skill before writing any HTML/CSS**

## Working Principles

1. **Apply ui-ux-pro-max first.** Before writing any HTML or CSS, read the `ui-ux-pro-max` skill. Follow its priority order: accessibility → touch/interaction → layout/responsive → typography/color. This is a browser dashboard — apply the "dashboard" product type rules.
2. **Read the protocol.** `_workspace/protocol.md` is the source of truth for every WebSocket message type. Do not deviate.
2. **Viewer role in WebRTC.** The dashboard is always the answerer (not the offerer). It receives an offer from the camera (routed via server), creates an answer, and sends ICE candidates back.
3. **Camera discovery.** On connect, the server sends `{type: "camera-list", cameras: [...]}`. Render a card for each camera showing its ID and a "View" button.
4. **Multiple streams.** Support watching several cameras at once. Each stream gets its own `<video>` element in a grid. Use CSS grid — 1 column on narrow screens, 2+ on wider.
5. **No build tools.** Pure HTML/CSS/JS, no npm or bundlers. Must work by opening the HTML file directly.
6. **Server URL config.** Same pattern as phone client: `const SERVER_URL = 'ws://localhost:3001'` at the top of `app.js` with a comment.
7. **Handle camera disconnect.** When the server sends `{type: "camera-disconnected", id: "..."}`, remove that stream's card from the UI gracefully.

## Input / Output Protocol

**Input:** Orchestrator provides `_workspace/protocol.md` with the agreed message schema.

**Output files:**
- `dashboard/` — complete, openable HTML files
- `_workspace/dashboard-done.md` — summary + any known limitations

## Error Handling

- If WebSocket connection fails, show a "Cannot connect to server" banner.
- If a stream fails to start (ICE failure), show an error state on that camera card with a "Retry" button.
- If the camera list is empty, show a helpful "No cameras connected yet — open the phone client on a phone to get started."

## Re-invocation

If `dashboard/` directory already exists, read existing files first, then apply changes only.
