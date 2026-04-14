---
name: remotecamera-test
description: "Project-specific test guidance for RemoteCamera. Covers what to test (server signaling, WebSocket message routing, camera registry), how to run tests (node:test), and what requires manual browser testing. Use alongside the global test-driven-development skill when writing or running tests for this project. Triggered by: 'write tests', 'test the server', 'run tests', 'add test coverage', 'test agent', 'test signaling', 'test the app'."
---

# RemoteCamera Test Skill

Project-specific context for the test-agent. Use **alongside** the global `test-driven-development` skill — that skill provides the TDD cycle rules; this skill tells you *what* to test and *how* to structure it for this project.

## Test Scope

### What CAN be tested in Node.js (automated)

| Behavior | Test type | File |
|----------|-----------|------|
| Camera `register` updates registry | Unit | `signaling.test.js` |
| `viewer-join` triggers `request-offer` to camera | Integration | `integration.test.js` |
| `offer` forwarded to correct viewer | Integration | `integration.test.js` |
| `answer` forwarded to correct camera | Integration | `integration.test.js` |
| `ice-candidate` forwarded to correct peer | Integration | `integration.test.js` |
| Camera disconnect → `camera-disconnected` sent to viewers | Integration | `integration.test.js` |
| Camera disconnect → removed from registry | Unit | `signaling.test.js` |
| `viewer-join` for unknown camera → `error` response | Integration | `integration.test.js` |
| `camera-list` sent on viewer connect | Integration | `integration.test.js` |
| Malformed message (no `type`) → no crash | Unit | `signaling.test.js` |

### What requires manual browser testing (document in test-done.md)

- `getUserMedia` camera permission prompt (Safari, Chrome)
- WebRTC offer/answer/ICE exchange resulting in live video
- Video rendering in `<video>` element
- Mobile layout on real device (portrait, touch targets)
- Dashboard camera grid on various screen sizes

## Test Setup Pattern

```js
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { createApp } from '../index.js'   // export the http server, don't auto-listen

let server, port

before(async () => {
  server = createApp()
  await new Promise(resolve => server.listen(0, resolve))  // random port
  port = server.address().port
})

after(() => server.close())

function connect() {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}`)
    ws.once('open', () => resolve(ws))
  })
}

function nextMessage(ws) {
  return new Promise(resolve => ws.once('message', d => resolve(JSON.parse(d))))
}
```

**Key requirement:** `server/index.js` must export a factory function (e.g., `export function createApp()`) that returns the http server without calling `.listen()`. This allows tests to start it on a random port. If the server currently auto-listens on import, that's the first refactor needed.

## Integration Test Example (Red → Green)

```js
test('viewer-join for unknown camera sends error', async () => {
  const viewer = await connect()
  
  // consume the camera-list message sent on connect
  await nextMessage(viewer)
  
  viewer.send(JSON.stringify({ type: 'viewer-join', camId: 'no-such-cam', viewerId: 'v1' }))
  
  const response = await nextMessage(viewer)
  assert.equal(response.type, 'error')
  assert.equal(response.message, 'camera-not-found')
  
  viewer.close()
})
```

Write this test first. Run it. Watch it fail (server doesn't handle `viewer-join` yet). Then implement the handler.

## Running Tests

Add to `server/package.json`:
```json
{
  "scripts": {
    "test": "node --test test/*.test.js"
  }
}
```

Run: `cd server && npm test`

Node 18+ required for `node:test`. If Node < 18, use the fallback pattern described in `test-agent.md`.

## Protocol Reference

Always read `_workspace/protocol.md` before writing tests — each message type there is a behavior contract that needs a test.
