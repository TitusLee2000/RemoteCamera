# RemoteCamera v4 — Recording API Contract

## Overview
Recording is CLIENT-SIDE: the phone uses MediaRecorder on its existing getUserMedia stream,
then uploads the completed WebM blob to the server via HTTP POST.

---

## Phone Client Responsibilities (Task 15)

### MediaRecorder setup
- Reuse the existing `localStream` from `getUserMedia`
- `new MediaRecorder(localStream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1_000_000 })`
- Collect `ondataavailable` chunks into a `Blob[]` array
- On stop: combine into single Blob, trigger upload

### UI additions (below existing controls)
- **Record button**: toggles Start/Stop recording
- **Recording indicator**: red dot + elapsed timer (MM:SS) visible while recording
- **Upload status**: shows "Uploading…" / "Saved ✓" / "Upload failed" after stop

### Upload
```
POST /api/recordings/upload
Content-Type: multipart/form-data

Fields:
  video   — the WebM Blob file
  camId   — string, the camera's ID
  startTime — ISO 8601 string, when recording started
  duration  — number, milliseconds
```

Response (201):
```json
{ "id": "abc_1713500000000", "url": "/api/recordings/abc_1713500000000/download" }
```

---

## Server Responsibilities (Task 16)

### New dependency
```
npm install multer
```

### New directory
`server/recordings/` — gitignored, stores .webm files

### New file
`server/recordings-store.js` — reads/writes `server/recordings.json`

### Endpoints

#### POST /api/recordings/upload
- Accept multipart with `multer`
- Save file as `recordings/{camId}_{startTime}.webm`
- Append to `recordings.json`:
  ```json
  { "id": "{camId}_{startTime}", "camId": "", "filename": "", "startTime": "", "duration": 0, "fileSize": 0, "uploadedAt": "" }
  ```
- Return `{ id, url }`

#### GET /api/recordings
- Return array from `recordings.json`, newest first
- Optional query: `?camId=xxx`

#### GET /api/recordings/:id/download
- Stream the file with `Content-Type: video/webm`

#### DELETE /api/recordings/:id
- Delete file from disk
- Remove entry from `recordings.json`
- Return `{ ok: true }`

---

## Dashboard Responsibilities (Task 17 + 20)

### New "Recordings" section
- Below the camera grid, above (or replacing) the motion log
- Shows a table: Camera | Date/Time | Duration | Size | Actions
- Play button → opens modal with `<video controls src="/api/recordings/:id/download">`
- Delete button → confirm → DELETE → remove row
- Filter dropdown by camera ID
- Empty state when no recordings
- Auto-refresh every 30s

---

## WebSocket: Remote Recording Trigger (Task 18)

### New messages

#### Dashboard → Server
```json
{ "type": "recording-start", "camId": "abc123" }
{ "type": "recording-stop",  "camId": "abc123" }
```

#### Server → Camera (forward)
```json
{ "type": "recording-start" }
{ "type": "recording-stop"  }
```

#### Camera → Server → Dashboard
```json
{ "type": "recording-status", "camId": "abc123", "recording": true }
{ "type": "recording-status", "camId": "abc123", "recording": false }
```

The camera client must listen for `recording-start` / `recording-stop` WebSocket messages
and start/stop the MediaRecorder accordingly, then broadcast `recording-status` back.
