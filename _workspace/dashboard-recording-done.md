# Dashboard Recording UI — Done

## Tasks completed: 17 & 20

### Files changed
- `dashboard/index.html`
- `dashboard/app.js`
- `dashboard/style.css`

### What was implemented

#### index.html
- Added a **Recordings section** below the Motion Events log, containing:
  - Header with "Recordings" h2, camera filter `<select>`, and Refresh button
  - A `<table>` (Camera | Date/Time | Duration | Size | Actions columns) with `<tbody id="recordings-tbody">`
  - Empty-state paragraph shown when no rows exist
- Added a **`.recording-badge`** (red pulsing dot + "REC" text) inside `.card-badges` in the camera card template — hidden by default, shown via JS when `recording-status: true` arrives
- Added a **playback modal** (`#playback-modal`) outside `<main>`: semi-transparent backdrop + centered card with metadata header (camera, time, duration), close button (X), and `<video controls>`

#### app.js
- New DOM refs for all recordings and modal elements
- `handleRecordingStatus(camId, recording)` — shows/hides `.recording-badge` on the relevant card; wired into `handleServerMessage` for `recording-status` messages
- `fetchRecordings(camIdFilter?)` — GET `/api/recordings?camId=...`, populates table and filter dropdown
- `renderRecordingsTable(recordings)` — builds `<tr>` rows with Play/Delete pill buttons; shows empty state when array is empty
- `populateCamFilter(recordings)` — merges recording camIds with currently connected cameras, rebuilds `<select>` options
- `fmtDuration(ms)` → `MM:SS`, `fmtSize(bytes)` → `X.X MB`, `fmtDateTime(iso)` → locale string
- `deleteRecording(id)` — confirm dialog → DELETE `/api/recordings/:id` → refresh list
- `openPlaybackModal(rec)` — sets `<video src>` and metadata, shows modal
- `closePlaybackModal()` — hides modal, pauses/clears video src
- `startRecordingsAutoRefresh()` — `setInterval` every 30 s
- Event listeners: Refresh button, filter change, backdrop click, close button, Escape key
- `escapeHtml()` helper to safely render camIds/ids in innerHTML
- Bootstrap calls: `fetchRecordings()` + `startRecordingsAutoRefresh()` on page load

#### style.css
- `.recording-badge` — red pill, matches `.motion-badge` style; `.rec-dot` with `rec-pulse` animation
- `.recordings-section` — top border + spacing matching `.motion-log-section`
- `.recordings-header` / `.recordings-controls` — flex row with filter select and refresh button
- `.recordings-filter` — styled select using existing CSS variables
- `.recordings-table-wrap` — rounded bordered container with `overflow-x: auto`
- `.recordings-table` — dark header row (`--bg-elev-2`), subtle row borders, hover highlight
- `.btn-pill` / `.btn-pill-play` / `.btn-pill-delete` — small pill action buttons matching existing badge aesthetic
- `.recordings-empty` — centered dim placeholder text
- `.playback-modal` / `.playback-backdrop` / `.playback-card` / `.playback-card-head` / `.playback-video` / `.playback-close-btn` / `.playback-meta` — full modal system with blur backdrop and centered 16:9 video

### Design decisions
- Recordings section is always visible (not hidden like motion log) so users can immediately see/refresh clips
- Camera filter dropdown is populated dynamically from recordings + connected cameras
- Modal closes on backdrop click, close button, or Escape key
- All new styles use existing CSS variables (`--bg`, `--bg-elev-1/2`, `--border`, `--danger`, `--primary`, etc.) — dark theme is consistent throughout
