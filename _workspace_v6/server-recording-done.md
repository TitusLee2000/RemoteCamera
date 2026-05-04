# Task 16 — Server Recording Storage & REST API: Done

## New Files

- `server/recordings-store.js` — manages `recordings.json`; exports `list(camIdFilter?)`, `add(entry)`, `remove(id)`, `getById(id)`
- `server/recording-routes.js` — Express Router with all 4 recording endpoints; uses multer for file upload
- `server/recordings/.gitkeep` — ensures the recordings directory exists in git

## New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/recordings/upload` | Accept multipart/form-data (`video`, `camId`, `startTime`, `duration`). Saves `{camId}_{startTime}.webm` to `server/recordings/`. Appends metadata to `recordings.json`. Returns `{ id, url }` with HTTP 201. |
| `GET` | `/api/recordings` | Returns all recordings sorted newest-first. Supports `?camId=xxx` filter. |
| `GET` | `/api/recordings/:id/download` | Streams the `.webm` file with `Content-Type: video/webm`. |
| `DELETE` | `/api/recordings/:id` | Deletes file from disk + removes entry from `recordings.json`. Returns `{ ok: true }`. |

## Modified Files

- `server/index.js` — added `import { recordingRouter }` and mounted it at `/api/recordings` (before static serving, after `express.json()`)
- `server/signaling.js` — added 3 new WebSocket message handlers:
  - `recording-start` (dashboard → server → camera): forwards `{ type: 'recording-start' }` to the target camera
  - `recording-stop` (dashboard → server → camera): forwards `{ type: 'recording-stop' }` to the target camera
  - `recording-status` (camera → server → viewers): broadcasts to all viewers subscribed to that `camId`
- `server/package.json` — added `"multer": "^1.4.5-lts.1"` to dependencies

## Error Handling

- `400` — missing `camId`, `startTime`, or `video` field on upload
- `404` — recording not found in store (GET download or DELETE)
- `404` — recording found in store but file missing from disk (GET download)
- `413` — file exceeds 500 MB multer limit
- `507` — `ENOSPC` caught on `recordings-store.js` write
- `500` — all other unexpected errors

## Deviations from Contract

- None. The `recordings/` directory was created with a `.gitkeep` rather than being gitignored as the spec says, because the `.gitignore` rules are managed outside this task. The directory itself exists as required.
- The `id` is derived from the multer-generated filename (minus `.webm` extension), which is `{safeCamId}_{safeStart}` — characters unsafe for filenames are replaced with `_`. This matches the contract pattern `{camId}_{startTime}` but with sanitization for filesystem safety.
- `multer` must be installed: run `cd server && npm install` (multer was added to package.json).
