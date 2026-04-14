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
{ "type": "offer", "offer": "<RTCSessionDescription>", "camId": "abc123", "targetId": "viewer-xyz" }
```

#### `ice-candidate`
ICE candidate for a specific viewer.
```json
{ "type": "ice-candidate", "candidate": "<RTCIceCandidate>", "camId": "abc123", "targetId": "viewer-xyz" }
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
{ "type": "answer", "answer": "<RTCSessionDescription>", "camId": "abc123", "targetId": "abc123", "viewerId": "viewer-xyz" }
```

#### `ice-candidate` (from viewer)
ICE candidate for the camera. Same shape as camera's ICE message but with `viewerId` as the sender identifier.
```json
{ "type": "ice-candidate", "candidate": "<RTCIceCandidate>", "viewerId": "viewer-xyz", "targetId": "abc123" }
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
{ "type": "answer", "answer": "<RTCSessionDescription>", "viewerId": "viewer-xyz" }
```

#### `ice-candidate` (forwarded to camera)
Server forwards the viewer's ICE candidate to the camera.
```json
{ "type": "ice-candidate", "candidate": "<RTCIceCandidate>", "viewerId": "viewer-xyz" }
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
{ "type": "offer", "offer": "<RTCSessionDescription>", "camId": "abc123" }
```

#### `ice-candidate` (forwarded to viewer)
Server forwards the camera's ICE candidate to the viewer.
```json
{ "type": "ice-candidate", "candidate": "<RTCIceCandidate>", "camId": "abc123" }
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

## Routing Logic (for server implementation)

- To route from camera to viewer: look up `targetId` (viewerId) in the viewers Map
- To route from viewer to camera: look up `targetId` (camId) in the cameras Map
- The server never needs to inspect offer/answer/candidate payloads — it only routes them
