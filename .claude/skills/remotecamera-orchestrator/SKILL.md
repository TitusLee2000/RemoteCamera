---
name: remotecamera-orchestrator
description: "Orchestrates the full RemoteCamera build — server, phone client, dashboard, and tests. Use when building the whole app, starting the project, wiring all three components together, or when the user says 'build it', 'start building', 'implement the app', 'build RemoteCamera'. Also triggers for: rebuild, re-run, update all components, fix integration, partial rebuild (e.g. 'rebuild just the server'), write tests, run tests, add test coverage, and any cross-cutting changes that affect multiple components. This skill coordinates server-agent, phone-client-agent, dashboard-agent, and test-agent."
---

# RemoteCamera Orchestrator

Coordinates four sub-agents to build a complete LAN WebRTC camera surveillance app: a Node.js signaling server, a mobile phone client, a browser dashboard, and a test suite.

## Execution Mode: Sub-Agent (Hybrid Pipeline)

- Phase 1 (Protocol): Inline — orchestrator writes the shared protocol document
- Phase 2 (Server): Sub-agent (sequential — must complete before others)
- Phase 3 (Client + Dashboard): Two sub-agents in parallel (`run_in_background: true`)
- Phase 4 (Tests): Sub-agent (sequential — runs after server is built, writes tests TDD-style)
- Phase 5 (Integration check): Inline — orchestrator verifies file structure and reports

## Agent Roster

| Agent | File | Skills | Output |
|-------|------|--------|--------|
| server-agent | `.claude/agents/server-agent.md` | server-build | `server/` |
| phone-client-agent | `.claude/agents/phone-client-agent.md` | phone-client-build | `client/` |
| dashboard-agent | `.claude/agents/dashboard-agent.md` | dashboard-build, ui-ux-pro-max | `dashboard/` |
| test-agent | `.claude/agents/test-agent.md` | remotecamera-test, test-driven-development | `server/test/` |

---

## Workflow

### Phase 0: Context Check

1. Check if `_workspace/` directory exists.
2. If yes + user requests partial change → **Partial re-run**: invoke only the relevant agent. Pass the existing `_workspace/protocol.md` as input.
3. If yes + new inputs → **New run**: rename `_workspace/` to `_workspace_prev/`, proceed to Phase 1.
4. If no → **Initial run**: proceed to Phase 1.

### Phase 1: Write the Shared Protocol

Create `_workspace/protocol.md` with the WebSocket signaling protocol. All three agents will read this file — it is the single source of truth.

Write the following content to `_workspace/protocol.md`:

```markdown
# RemoteCamera WebSocket Signaling Protocol

All messages are JSON. Both cameras and viewers connect to the same WebSocket server.

## Connection Roles

- **Camera**: a phone running the client app, sends video
- **Viewer**: a dashboard browser tab, receives video

## Message Catalog

### Camera → Server

#### `register`
Camera announces itself.
```json
{ "type": "register", "camId": "abc123" }
```

#### `offer`
WebRTC offer routed to a specific viewer.
```json
{ "type": "offer", "offer": <RTCSessionDescription>, "camId": "abc123", "targetId": "viewer-xyz" }
```

#### `ice-candidate`
ICE candidate for a specific viewer.
```json
{ "type": "ice-candidate", "candidate": <RTCIceCandidate>, "camId": "abc123", "targetId": "viewer-xyz" }
```

### Viewer → Server

#### `viewer-join`
Viewer wants to watch a specific camera.
```json
{ "type": "viewer-join", "camId": "abc123", "viewerId": "viewer-xyz" }
```

#### `answer`
WebRTC answer routed back to the camera.
```json
{ "type": "answer", "answer": <RTCSessionDescription>, "camId": "abc123", "targetId": "abc123", "viewerId": "viewer-xyz" }
```

#### `ice-candidate`
ICE candidate for the camera. Same shape as camera's ICE message but with `viewerId` instead of `camId` as the sender identifier.
```json
{ "type": "ice-candidate", "candidate": <RTCIceCandidate>, "viewerId": "viewer-xyz", "targetId": "abc123" }
```

### Server → Camera

#### `request-offer`
Server tells camera a viewer wants to watch. Camera should initiate WebRTC offer.
```json
{ "type": "request-offer", "viewerId": "viewer-xyz" }
```

#### `answer` (forwarded)
Server forwards the viewer's answer to the camera.
```json
{ "type": "answer", "answer": <RTCSessionDescription>, "viewerId": "viewer-xyz" }
```

#### `ice-candidate` (forwarded)
Server forwards the viewer's ICE candidate to the camera.
```json
{ "type": "ice-candidate", "candidate": <RTCIceCandidate>, "viewerId": "viewer-xyz" }
```

### Server → Viewer

#### `camera-list`
Sent on viewer connect, and whenever the camera roster changes.
```json
{ "type": "camera-list", "cameras": ["abc123", "def456"] }
```

#### `offer` (forwarded)
Server forwards the camera's offer to the viewer.
```json
{ "type": "offer", "offer": <RTCSessionDescription>, "camId": "abc123" }
```

#### `ice-candidate` (forwarded)
Server forwards the camera's ICE candidate to the viewer.
```json
{ "type": "ice-candidate", "candidate": <RTCIceCandidate>, "camId": "abc123" }
```

#### `camera-disconnected`
Server notifies viewers when a camera leaves.
```json
{ "type": "camera-disconnected", "id": "abc123" }
```

#### `error`
Server reports an error to the viewer.
```json
{ "type": "error", "message": "camera-not-found" }
```

## WebRTC Flow Summary

1. Camera connects → sends `register`
2. Viewer connects → server sends `camera-list`
3. Viewer clicks "View" → sends `viewer-join`
4. Server sends `request-offer` to camera
5. Camera creates offer → sends `offer` to server → forwarded to viewer
6. Viewer creates answer → sends `answer` to server → forwarded to camera
7. Both sides exchange `ice-candidate` messages via server
8. WebRTC connection established — video flows peer-to-peer (or via TURN if NAT blocks P2P)
```

### Phase 2: Build the Server (Sequential)

Invoke server-agent as a sub-agent. Server must be complete before clients so they can reference its actual implementation for any clarifications.

```
Agent(
  description: "Build RemoteCamera server",
  subagent_type: "server-agent",
  model: "opus",
  prompt: "
    You are the server-agent for RemoteCamera. Read your agent definition at
    .claude/agents/server-agent.md and the skill at .claude/skills/server-build/SKILL.md.
    Read the signaling protocol at _workspace/protocol.md — this is your contract.
    
    Build the complete Node.js signaling server in the /server directory.
    When done, write a brief summary to _workspace/server-done.md.
  "
)
```

Wait for this agent to complete before proceeding.

### Phase 3: Build Client + Dashboard (Parallel)

Invoke both agents simultaneously with `run_in_background: true`.

**phone-client-agent:**
```
Agent(
  description: "Build RemoteCamera phone client",
  subagent_type: "phone-client-agent",
  model: "opus",
  run_in_background: true,
  prompt: "
    You are the phone-client-agent for RemoteCamera. Read your agent definition at
    .claude/agents/phone-client-agent.md and the skill at .claude/skills/phone-client-build/SKILL.md.
    Read the signaling protocol at _workspace/protocol.md — implement exactly these message types.
    
    Build the complete phone client in the /client directory.
    When done, write a brief summary to _workspace/client-done.md.
  "
)
```

**dashboard-agent:**
```
Agent(
  description: "Build RemoteCamera dashboard",
  subagent_type: "dashboard-agent",
  model: "opus",
  run_in_background: true,
  prompt: "
    You are the dashboard-agent for RemoteCamera. Read your agent definition at
    .claude/agents/dashboard-agent.md and the skill at .claude/skills/dashboard-build/SKILL.md.
    Read the signaling protocol at _workspace/protocol.md — implement exactly these message types.
    
    Build the complete dashboard in the /dashboard directory.
    When done, write a brief summary to _workspace/dashboard-done.md.
  "
)
```

Wait for both background agents to complete.

### Phase 4: Write Tests (Sequential)

Invoke test-agent after the server is built. Tests are written TDD-style against the real server code — the agent reads the server source, writes failing tests first, then ensures they pass.

```
Agent(
  description: "Write RemoteCamera server tests",
  subagent_type: "test-agent",
  model: "opus",
  prompt: "
    You are the test-agent for RemoteCamera. Read your agent definition at
    .claude/agents/test-agent.md.
    Read your skills:
      - .claude/skills/remotecamera-test/SKILL.md (project-specific test context)
      - ~/.claude/skills/test-driven-development/SKILL.md (TDD rules — Red/Green/Refactor)
    Read the signaling protocol at _workspace/protocol.md.
    Read the server source in server/ to understand the current implementation.
    
    Write tests for all signaling behaviors defined in the protocol using TDD.
    The server/index.js must export a createApp() factory (not auto-listen) — add this
    export if it's missing before writing tests.
    
    When done, write results to _workspace/test-done.md including:
    - which tests pass
    - which behaviors need manual browser testing (list them)
  "
)
```

Wait for test-agent to complete.

### Phase 5: Integration Check

Verify the build is complete and coherent:

1. Check these files exist:
   - `server/index.js`, `server/package.json`, `server/signaling.js`
   - `server/test/signaling.test.js`, `server/test/integration.test.js`
   - `client/index.html`, `client/app.js`
   - `dashboard/index.html`, `dashboard/app.js`

2. Read `_workspace/server-done.md`, `_workspace/client-done.md`, `_workspace/dashboard-done.md`, `_workspace/test-done.md` — note any deviations or test failures.

3. Report to user:
   - What was built
   - Test results summary
   - Behaviors that need manual browser testing
   - How to run it (server first, then open client + dashboard)
   - Any deviations or known limitations

## Error Handling

- If server-agent fails: do not proceed to Phase 3 or 4. Report the error. All other agents depend on the server being built.
- If one of Phase 3 agents fails: continue with the other, note the failure in the report.
- If test-agent fails: note the failure but still proceed to Phase 5. Report which tests couldn't be written.
- If an agent deviates from the protocol: note the deviation in the integration report. Do not auto-correct — surface it to the user.

## Data Flow

```
Orchestrator writes _workspace/protocol.md
         ↓
   server-agent reads protocol → builds /server
         ↓
   phone-client-agent reads protocol → builds /client      (parallel)
   dashboard-agent reads protocol → builds /dashboard      (parallel, uses ui-ux-pro-max)
         ↓
   test-agent reads protocol + server/ → writes server/test/ (TDD, uses test-driven-development)
         ↓
   Orchestrator reads *-done.md → integration report → user
```

## Test Scenarios

**Normal flow:**
1. Run `cd server && npm install && node index.js`
2. Open `dashboard/index.html` in a laptop browser
3. Open `client/index.html` in a phone browser, allow camera, tap "Start Streaming"
4. Dashboard shows the camera card; click "View"; video appears

**Error flow:**
1. Start dashboard before server → should show "Cannot connect to server" message
2. Stop camera mid-stream → dashboard should show "Offline" state, not crash

## How to Run (tell user at end)

```bash
# 1. Start the server
cd server
npm install
node index.js        # runs on port 3001 by default

# 2. Open the dashboard (on any computer on the LAN)
open dashboard/index.html    # or just double-click it

# 3. Open the phone client (on the phone)
# Navigate to http://<your-computer-ip>:3001/client
# (or open client/index.html if serving static files)
# Allow camera access, tap "Start Streaming"

# 4. In the dashboard, click "View" next to the camera ID
```

Note: Change `SERVER_URL` in both `client/app.js` and `dashboard/app.js` to use your computer's LAN IP address (e.g., `ws://192.168.1.42:3001`).
