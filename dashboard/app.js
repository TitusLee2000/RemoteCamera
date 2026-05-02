// ===== RemoteCamera Dashboard =====
// Viewer (answerer) role. Connects to the signaling server, lists cameras,
// and sets up WebRTC peer connections to receive video streams.

// SERVER_URL auto-detects based on current page protocol and host.
// Works on LAN (ws://) and in production (wss://) with no manual changes.
// Override by setting window.SERVER_URL_OVERRIDE before this script loads.
const SERVER_URL = window.SERVER_URL_OVERRIDE ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
// ICE servers are fetched from the server at runtime so credentials stay
// out of client code. Falls back to STUN-only if the fetch fails (LAN use).
async function getIceServers() {
  try {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 4000)
    const res = await fetch('/api/ice-servers', { signal: controller.signal })
    if (res.ok) return await res.json()
  } catch {}
  return [{ urls: 'stun:stun.l.google.com:19302' }]
}

// ----- State -----
// camId -> { status: 'idle'|'connecting'|'live'|'offline'|'error', pc: RTCPeerConnection|null, dimmed: boolean, motionTimer: null }
const cameras = {};
const motionEvents = []; // { camId, timestamp } — last 100 events
const MOTION_ALERT_DURATION_MS = 5000;
const MAX_LOG_ENTRIES = 100;
let recordingsRefreshTimer = null;

// Stable viewer id for this browser tab
const viewerId = 'viewer-' + Math.random().toString(36).slice(2, 10);

let ws = null;
let reconnectTimer = null;
let reconnectDelay = 1000; // ms, with exponential backoff

// ----- DOM refs -----
const grid = document.getElementById('camera-grid');
const emptyState = document.getElementById('empty-state');
const cardTemplate = document.getElementById('camera-card-template');
const errorBanner = document.getElementById('error-banner');
const connIndicator = document.getElementById('conn-indicator');
const connText = connIndicator.querySelector('.conn-text');
const cameraCount = document.getElementById('camera-count');
const motionLogSection = document.getElementById('motion-log-section');
const motionLogEl = document.getElementById('motion-log');
const clearLogBtn = document.getElementById('clear-log-btn');

// Recordings DOM refs
const recordingsCamFilter = document.getElementById('recordings-cam-filter');
const refreshRecordingsBtn = document.getElementById('refresh-recordings-btn');
const recordingsTbody = document.getElementById('recordings-tbody');
const recordingsEmpty = document.getElementById('recordings-empty');

// Playback modal refs
const playbackModal = document.getElementById('playback-modal');
const playbackBackdrop = document.getElementById('playback-backdrop');
const playbackVideo = document.getElementById('playback-video');
const playbackMetaCam = document.getElementById('playback-meta-cam');
const playbackMetaTime = document.getElementById('playback-meta-time');
const playbackMetaDur = document.getElementById('playback-meta-dur');
const playbackCloseBtn = document.getElementById('playback-close-btn');

clearLogBtn.addEventListener('click', () => {
  motionEvents.length = 0;
  motionLogEl.innerHTML = '';
  motionLogSection.hidden = true;
});

// ============================================================
// WebSocket lifecycle
// ============================================================
function connect() {
  setConnState('connecting', 'Connecting…');
  try {
    ws = new WebSocket(SERVER_URL);
  } catch (err) {
    console.error('WebSocket constructor failed:', err);
    showErrorBanner(true);
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    console.log('[ws] connected');
    showErrorBanner(false);
    setConnState('connected', 'Connected');
    reconnectDelay = 1000;
  });

  ws.addEventListener('message', (event) => {
    let msg;
    try { msg = JSON.parse(event.data); }
    catch { console.warn('Bad message:', event.data); return; }
    handleServerMessage(msg);
  });

  ws.addEventListener('close', () => {
    console.warn('[ws] closed');
    setConnState('error', 'Disconnected');
    showErrorBanner(true);
    // Mark all live cameras as offline since signaling is gone
    Object.keys(cameras).forEach((camId) => {
      if (cameras[camId].status === 'connecting' || cameras[camId].status === 'live') {
        markOffline(camId);
      }
    });
    scheduleReconnect();
  });

  ws.addEventListener('error', (err) => {
    console.error('[ws] error', err);
    setConnState('error', 'Connection error');
    showErrorBanner(true);
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 1.5, 10000);
    connect();
  }, reconnectDelay);
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('Cannot send, ws not open:', obj);
    return;
  }
  ws.send(JSON.stringify(obj));
}

// ============================================================
// Server -> Dashboard messages
// ============================================================
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'camera-list':
      handleCameraList(msg.cameras || []);
      break;

    case 'camera-disconnected':
      handleCameraDisconnected(msg.id);
      break;

    case 'offer':
      // { type: 'offer', offer, camId }
      handleOffer(msg.offer, msg.camId);
      break;

    case 'ice-candidate':
      // { type: 'ice-candidate', candidate, camId }
      handleRemoteIce(msg.candidate, msg.camId);
      break;

    case 'motion':
      handleMotion(msg.camId, msg.timestamp);
      break;

    case 'lock-state':
      handleLockState(msg.camId, msg.locked);
      break;

    case 'recording-status':
      handleRecordingStatus(msg.camId, msg.recording);
      break;

    case 'error':
      console.error('[server error]', msg.message);
      break;

    default:
      console.warn('Unknown message type:', msg.type, msg);
  }
}

function handleCameraList(camList) {
  // camList is [{ id, locked }]
  const activeIds = camList.map((c) => c.id);

  camList.forEach(({ id: camId, locked }) => {
    if (!cameras[camId]) {
      cameras[camId] = { status: 'idle', pc: null, dimmed: locked, removeTimer: null, motionTimer: null, sensitivity: 20, recording: false, autoRecord: false, autoRecordDuration: 5000, autoRecordStopTimer: null };
      renderCard(camId);
    } else {
      // Cancel pending removal if camera came back within the grace period
      if (cameras[camId].removeTimer) {
        clearTimeout(cameras[camId].removeTimer);
        cameras[camId].removeTimer = null;
      }
      if (cameras[camId].status === 'offline') {
        cameras[camId].status = 'idle';
        updateCardStatus(camId, 'idle');
      }
    }
    updateDimState(camId, locked);
  });

  // Mark cameras no longer in the list as offline (don't remove)
  Object.keys(cameras).forEach((camId) => {
    if (!activeIds.includes(camId)) {
      markOffline(camId);
    }
  });

  refreshEmptyState();
}

function handleCameraDisconnected(camId) {
  if (!cameras[camId]) return;
  markOffline(camId);
  refreshEmptyState();
}

function markOffline(camId) {
  const cam = cameras[camId];
  if (!cam) return;
  if (cam.pc) {
    try { cam.pc.close(); } catch (e) {}
    cam.pc = null;
  }

  // Clear any existing removal timer (e.g. called twice in quick succession)
  if (cam.removeTimer) clearTimeout(cam.removeTimer);

  cam.status = 'offline';
  updateCardStatus(camId, 'offline');

  // Remove the card after 5 seconds if still offline.
  // This handles brief WebSocket blips without flashing cards off the screen.
  cam.removeTimer = setTimeout(() => {
    if (cameras[camId]?.status === 'offline') {
      delete cameras[camId];
      const card = getCardEl(camId);
      if (card) card.remove();
      refreshEmptyState();
    }
  }, 5000);
}

// ============================================================
// WebRTC (answerer)
// ============================================================
async function handleOffer(offer, camId) {
  const cam = cameras[camId];
  if (!cam) {
    console.warn('Offer for unknown camera', camId);
    return;
  }

  // Tear down any prior connection
  if (cam.pc) {
    try { cam.pc.close(); } catch {}
  }

  const iceServers = await getIceServers()
  const pc = new RTCPeerConnection({ iceServers });
  cam.pc = pc;

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      send({
        type: 'ice-candidate',
        candidate,
        viewerId,
        targetId: camId,
      });
    }
  };

  // Store the stream when tracks arrive but don't show LIVE yet —
  // ontrack fires during SDP negotiation, before ICE connects and media flows.
  pc.ontrack = ({ streams }) => {
    const card = getCardEl(camId);
    if (!card) return;
    const video = card.querySelector('video');
    if (video && streams[0]) video.srcObject = streams[0];
  };

  // iceConnectionState is more reliable cross-browser (especially iOS WebKit)
  // than connectionState. Use it as the primary signal for LIVE / error.
  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    console.log(`[pc:${camId}] iceConnectionState =`, state);
    if (state === 'connected' || state === 'completed') {
      cam.status = 'live';
      updateCardStatus(camId, 'live');
    } else if (state === 'failed') {
      if (cameras[camId] && cameras[camId].status !== 'offline') {
        cam.status = 'error';
        updateCardStatus(camId, 'error');
      }
    } else if (state === 'disconnected') {
      if (cameras[camId] && cameras[camId].status === 'live') {
        cam.status = 'connecting';
        updateCardStatus(camId, 'connecting');
      }
    }
  };

  try {
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    send({
      type: 'answer',
      answer,
      camId,
      targetId: camId,
      viewerId,
    });
  } catch (err) {
    console.error('handleOffer failed for', camId, err);
    cam.status = 'error';
    updateCardStatus(camId, 'error');
  }
}

async function handleRemoteIce(candidate, camId) {
  const cam = cameras[camId];
  if (!cam || !cam.pc) return;
  try {
    await cam.pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn('addIceCandidate failed', err);
  }
}

// ============================================================
// Motion alerts + event log
// ============================================================
function handleMotion(camId, timestamp) {
  if (!cameras[camId]) return;

  // Visual alert — flash motion badge on card
  const card = getCardEl(camId);
  if (card) {
    const badge = card.querySelector('.motion-badge');
    if (badge) {
      badge.hidden = false;
      clearTimeout(cameras[camId].motionTimer);
      cameras[camId].motionTimer = setTimeout(() => {
        badge.hidden = true;
      }, MOTION_ALERT_DURATION_MS);
    }
    card.classList.add('motion-alert');
    setTimeout(() => card.classList.remove('motion-alert'), 600);
  }

  // Sound alert
  playMotionBeep();

  // Auto-record on motion
  triggerDashboardAutoRecord(camId);

  // Log entry
  const entry = { camId, timestamp };
  motionEvents.unshift(entry);
  if (motionEvents.length > MAX_LOG_ENTRIES) motionEvents.pop();
  prependLogEntry(entry);
  motionLogSection.hidden = false;
}

function prependLogEntry({ camId, timestamp }) {
  const li = document.createElement('li');
  li.className = 'motion-log-entry';
  const time = new Date(timestamp).toLocaleTimeString();
  li.innerHTML = `<span class="log-time">${time}</span><span class="log-cam">Camera <code>${camId}</code></span>`;
  motionLogEl.prepend(li);
  // Trim rendered list to MAX_LOG_ENTRIES
  while (motionLogEl.children.length > MAX_LOG_ENTRIES) {
    motionLogEl.lastChild.remove();
  }
}

let audioCtx = null;
function playMotionBeep() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.25);
  } catch (e) {}
}

// ============================================================
// Lock / dim
// ============================================================
function handleLockState(camId, locked) {
  if (!cameras[camId]) return;
  cameras[camId].dimmed = locked;
  updateDimState(camId, locked);
}

function remoteDim(camId, locked) {
  send({ type: 'remote-lock', camId, locked });
  // Optimistically update UI — server will confirm via lock-state broadcast
  if (cameras[camId]) cameras[camId].dimmed = locked;
  updateDimState(camId, locked);
}

function updateDimState(camId, locked) {
  const card = getCardEl(camId);
  if (!card) return;
  const toggle = card.querySelector('.dim-toggle-input');
  if (toggle) toggle.checked = locked;
}

function toggleCollapse(card, camId) {
  const collapsed = card.dataset.collapsed === 'true';
  card.dataset.collapsed = collapsed ? 'false' : 'true';
  const collapseBtn = card.querySelector('.collapse-btn');
  collapseBtn.setAttribute('aria-label', collapsed ? 'Collapse camera card' : 'Expand camera card');
}

// ============================================================
// User actions
// ============================================================
function startView(camId) {
  const cam = cameras[camId];
  if (!cam) return;
  if (cam.status === 'connecting' || cam.status === 'live') return;

  cam.status = 'connecting';
  updateCardStatus(camId, 'connecting');

  send({
    type: 'viewer-join',
    camId,
    viewerId,
  });
}

function retryView(camId) {
  const cam = cameras[camId];
  if (!cam) return;
  if (cam.pc) {
    try { cam.pc.close(); } catch {}
    cam.pc = null;
  }
  cam.status = 'idle';
  updateCardStatus(camId, 'idle');
  startView(camId);
}

function toggleFullscreen(videoEl) {
  const doc = document;
  const isFs =
    doc.fullscreenElement || doc.webkitFullscreenElement || doc.msFullscreenElement;

  if (isFs) {
    if (doc.exitFullscreen) doc.exitFullscreen();
    else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    else if (doc.msExitFullscreen) doc.msExitFullscreen();
  } else {
    if (videoEl.requestFullscreen) videoEl.requestFullscreen();
    else if (videoEl.webkitRequestFullscreen) videoEl.webkitRequestFullscreen();
    else if (videoEl.webkitEnterFullscreen) videoEl.webkitEnterFullscreen(); // iOS
    else if (videoEl.msRequestFullscreen) videoEl.msRequestFullscreen();
  }
}

// ============================================================
// Rendering
// ============================================================
function getCardEl(camId) {
  return grid.querySelector(`[data-cam-id="${cssEscape(camId)}"]`);
}

function renderCard(camId) {
  if (getCardEl(camId)) return; // already exists

  const node = cardTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.camId = camId;
  node.dataset.status = cameras[camId].status;

  node.querySelector('.cam-id-value').textContent = camId;

  const badge = node.querySelector('.status-badge');
  setBadge(badge, cameras[camId].status);

  const viewBtn = node.querySelector('.view-btn');
  viewBtn.addEventListener('click', () => startView(camId));

  const retryBtn = node.querySelector('.retry-btn');
  retryBtn.addEventListener('click', () => retryView(camId));

  const dimToggle = node.querySelector('.dim-toggle-input');
  dimToggle.addEventListener('change', () => {
    remoteDim(camId, dimToggle.checked);
  });

  const sensitivitySlider = node.querySelector('.sensitivity-slider');
  const sensitivityVal = node.querySelector('.sensitivity-val');
  sensitivitySlider.addEventListener('input', () => {
    const val = Number(sensitivitySlider.value);
    sensitivityVal.textContent = val;
    if (cameras[camId]) cameras[camId].sensitivity = val;
    send({ type: 'set-sensitivity', camId, sensitivity: val });
  });

  const collapseBtn = node.querySelector('.collapse-btn');
  collapseBtn.addEventListener('click', () => toggleCollapse(node, camId));

  const fsBtn = node.querySelector('.fullscreen-btn');
  const video = node.querySelector('video');
  fsBtn.addEventListener('click', () => toggleFullscreen(video));

  const recordBtn = node.querySelector('.record-btn');
  recordBtn.addEventListener('click', () => remoteRecord(camId));

  const autoRecordToggle = node.querySelector('.auto-record-toggle');
  autoRecordToggle.addEventListener('change', () => {
    if (cameras[camId]) cameras[camId].autoRecord = autoRecordToggle.checked;
  });

  const autoRecordDuration = node.querySelector('.auto-record-duration');
  autoRecordDuration.addEventListener('change', () => {
    const secs = Math.max(1, Math.min(300, Number(autoRecordDuration.value) || 5));
    autoRecordDuration.value = secs;
    if (cameras[camId]) cameras[camId].autoRecordDuration = secs * 1000;
  });

  grid.appendChild(node);
  refreshEmptyState();
}

function updateCardStatus(camId, status) {
  const card = getCardEl(camId);
  if (!card) return;
  card.dataset.status = status;
  const badge = card.querySelector('.status-badge');
  setBadge(badge, status);

  // Manage button labels for offline state
  const viewBtn = card.querySelector('.view-btn');
  const retryBtn = card.querySelector('.retry-btn');

  // fullscreen + record only shown when live
  card.querySelector('.fullscreen-btn').hidden = true;
  card.querySelector('.record-btn').hidden = true;

  if (status === 'offline') {
    viewBtn.hidden = true;
    retryBtn.hidden = false;
    retryBtn.textContent = 'Reconnect';
    retryBtn.style.flex = '1';
    retryBtn.disabled = true;
  } else if (status === 'error') {
    viewBtn.hidden = true;
    retryBtn.hidden = false;
    retryBtn.textContent = 'Retry';
    retryBtn.disabled = false;
  } else if (status === 'idle') {
    viewBtn.hidden = false;
    viewBtn.disabled = false;
    retryBtn.hidden = true;
  } else if (status === 'connecting') {
    viewBtn.hidden = false;
    viewBtn.disabled = true;
    viewBtn.textContent = 'Connecting…';
    retryBtn.hidden = true;
  } else if (status === 'live') {
    viewBtn.hidden = true;
    retryBtn.hidden = true;
    card.querySelector('.fullscreen-btn').hidden = false;
    card.querySelector('.record-btn').hidden = false;
  }

  // Reset "View" label when going back to idle from connecting
  if (status === 'idle') {
    viewBtn.textContent = 'View';
  }
}

function setBadge(badgeEl, status) {
  badgeEl.dataset.status = status;
  const text = badgeEl.querySelector('.status-text');
  text.textContent = {
    idle: 'Idle',
    connecting: 'Live',
    live: 'Live',
    offline: 'Offline',
    error: 'Error',
  }[status] || status;
}

function refreshEmptyState() {
  const count = Object.keys(cameras).length;
  cameraCount.textContent = count === 1 ? '1 camera' : `${count} cameras`;
  emptyState.hidden = count > 0;
}

function showErrorBanner(show) {
  errorBanner.hidden = !show;
}

function setConnState(state, label) {
  connIndicator.dataset.state = state;
  connText.textContent = label;
}

// ----- Helpers -----
function cssEscape(s) {
  if (window.CSS && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

// ============================================================
// Recording status (WebSocket push)
// ============================================================
function handleRecordingStatus(camId, recording) {
  const card = getCardEl(camId);
  if (!card) return;
  const badge = card.querySelector('.recording-badge');
  if (badge) badge.hidden = !recording;
  const btn = card.querySelector('.record-btn');
  if (btn) {
    btn.classList.toggle('recording', recording);
    btn.querySelector('.rec-btn-text').textContent = recording ? 'Stop Rec' : 'Record';
    btn.setAttribute('aria-label', recording ? 'Stop recording' : 'Start recording');
  }
  if (cameras[camId]) cameras[camId].recording = recording;
}

function remoteRecord(camId) {
  const cam = cameras[camId];
  if (!cam) return;
  const isRecording = cam.recording ?? false;
  send({ type: isRecording ? 'recording-stop' : 'recording-start', camId });
}

function triggerDashboardAutoRecord(camId) {
  const cam = cameras[camId];
  if (!cam || !cam.autoRecord) return;
  if (!cam.recording) {
    send({ type: 'recording-start', camId });
  }
  // Debounce: extend stop timer on each motion event
  clearTimeout(cam.autoRecordStopTimer);
  cam.autoRecordStopTimer = setTimeout(() => {
    if (cameras[camId] && cameras[camId].recording) {
      send({ type: 'recording-stop', camId });
    }
  }, cam.autoRecordDuration);
}

// ============================================================
// Recordings — REST API
// ============================================================

// Format helpers
function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '—';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

async function fetchRecordings(camIdFilter) {
  try {
    const url = camIdFilter
      ? `/api/recordings?camId=${encodeURIComponent(camIdFilter)}`
      : '/api/recordings';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderRecordingsTable(data);
    populateCamFilter(data);
  } catch (err) {
    console.error('fetchRecordings failed:', err);
  }
}

function populateCamFilter(recordings) {
  const currentVal = recordingsCamFilter.value;
  // Collect unique camIds from recordings plus any currently connected camera
  const camIds = new Set(recordings.map((r) => r.camId));
  Object.keys(cameras).forEach((id) => camIds.add(id));

  // Rebuild options, keep current selection
  recordingsCamFilter.innerHTML = '<option value="">All Cameras</option>';
  camIds.forEach((id) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = id;
    if (id === currentVal) opt.selected = true;
    recordingsCamFilter.appendChild(opt);
  });
  if (currentVal && !camIds.has(currentVal)) {
    recordingsCamFilter.value = '';
  }
}

function renderRecordingsTable(recordings) {
  recordingsTbody.innerHTML = '';
  if (!recordings || recordings.length === 0) {
    recordingsEmpty.hidden = false;
    return;
  }
  recordingsEmpty.hidden = true;

  recordings.forEach((rec) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code class="rec-cam-id">${escapeHtml(rec.camId)}</code></td>
      <td class="rec-datetime">${fmtDateTime(rec.startTime)}</td>
      <td class="rec-duration">${fmtDuration(rec.duration)}</td>
      <td class="rec-size">${fmtSize(rec.fileSize)}</td>
      <td class="rec-actions">
        <button type="button" class="btn-pill btn-pill-play" data-id="${escapeHtml(rec.id)}" aria-label="Play recording">Play</button>
        <button type="button" class="btn-pill btn-pill-delete" data-id="${escapeHtml(rec.id)}" aria-label="Delete recording">Delete</button>
      </td>
    `;

    tr.querySelector('.btn-pill-play').addEventListener('click', () => {
      openPlaybackModal(rec);
    });
    tr.querySelector('.btn-pill-delete').addEventListener('click', () => {
      deleteRecording(rec.id);
    });

    recordingsTbody.appendChild(tr);
  });
}

async function deleteRecording(id) {
  if (!confirm('Delete this recording? This cannot be undone.')) return;
  try {
    const res = await fetch(`/api/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fetchRecordings(recordingsCamFilter.value || undefined);
  } catch (err) {
    console.error('deleteRecording failed:', err);
    alert('Failed to delete recording. Please try again.');
  }
}

function openPlaybackModal(rec) {
  playbackVideo.src = `/api/recordings/${encodeURIComponent(rec.id)}/download`;
  playbackMetaCam.textContent = `Camera: ${rec.camId}`;
  playbackMetaTime.textContent = fmtDateTime(rec.startTime);
  playbackMetaDur.textContent = `Duration: ${fmtDuration(rec.duration)}`;
  playbackModal.hidden = false;
  playbackVideo.focus();
}

function closePlaybackModal() {
  playbackModal.hidden = true;
  playbackVideo.pause();
  playbackVideo.src = '';
}

function startRecordingsAutoRefresh() {
  clearInterval(recordingsRefreshTimer);
  recordingsRefreshTimer = setInterval(() => {
    fetchRecordings(recordingsCamFilter.value || undefined);
  }, 30000);
}

// Recordings event listeners
refreshRecordingsBtn.addEventListener('click', () => {
  fetchRecordings(recordingsCamFilter.value || undefined);
});

recordingsCamFilter.addEventListener('change', () => {
  fetchRecordings(recordingsCamFilter.value || undefined);
});

playbackCloseBtn.addEventListener('click', closePlaybackModal);
playbackBackdrop.addEventListener('click', closePlaybackModal);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !playbackModal.hidden) closePlaybackModal();
});

// ----- HTML escape helper -----
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Bootstrap
refreshEmptyState();
connect();
fetchRecordings();
startRecordingsAutoRefresh();

// ============================================================
// Session + role init
// ============================================================
async function initSession() {
  const res = await fetch('/api/auth/me')
  if (!res.ok) { window.location.href = '/login'; return }
  const user = await res.json()
  window._userRole = user.role
  if (user.role === 'operator' || user.role === 'admin') {
    document.getElementById('slots-section').hidden = false
    fetchSlots()
  }
  if (user.role === 'admin') {
    document.getElementById('admin-section').hidden = false
    fetchUsers()
  }
}

// ============================================================
// Slot management (operator only)
// ============================================================
async function fetchSlots() {
  const res = await fetch('/api/slots')
  if (!res.ok) { console.error('fetchSlots failed', res.status, await res.text()); return }
  const slots = await res.json()
  renderSlots(slots)
}

function renderSlots(slots) {
  const tbody = document.getElementById('slots-tbody')
  tbody.innerHTML = ''
  for (const slot of slots) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${slot.name}</td>
      <td>
        <span class="code-masked" data-code="${slot.code}">••••••••••••</span>
        <button class="btn-pill reveal-btn" data-code="${slot.code}">Reveal</button>
        <button class="btn-pill copy-btn" data-code="${slot.code}">Copy</button>
      </td>
      <td><span class="slot-status ${slot.live ? 'live' : 'idle'}">${slot.live ? 'Live' : 'Idle'}</span></td>
      <td>
        <button class="btn-pill regen-btn" data-id="${slot.id}">Regen Code</button>
        <button class="btn-pill delete-slot-btn" data-id="${slot.id}">Delete</button>
      </td>
    `
    tbody.appendChild(tr)
  }

  tbody.querySelectorAll('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const masked = btn.previousElementSibling
      const isRevealed = masked.textContent !== '••••••••••••'
      masked.textContent = isRevealed ? '••••••••••••' : btn.dataset.code
      btn.textContent = isRevealed ? 'Reveal' : 'Hide'
    })
  })
  tbody.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', () => navigator.clipboard.writeText(btn.dataset.code))
  })
  tbody.querySelectorAll('.regen-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Regenerate code? The connected camera will be disconnected.')) return
      await fetch(`/api/slots/${btn.dataset.id}/regenerate`, { method: 'POST' })
      fetchSlots()
    })
  })
  tbody.querySelectorAll('.delete-slot-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete slot? The connected camera will be disconnected.')) return
      await fetch(`/api/slots/${btn.dataset.id}`, { method: 'DELETE' })
      fetchSlots()
    })
  })
}

document.getElementById('add-slot-btn')?.addEventListener('click', () => {
  document.getElementById('add-slot-form').hidden = false
})
document.getElementById('slot-name-cancel')?.addEventListener('click', () => {
  document.getElementById('add-slot-form').hidden = true
})
document.getElementById('slot-name-submit')?.addEventListener('click', async () => {
  const name = document.getElementById('slot-name-input').value.trim()
  const errEl = document.getElementById('slot-form-error')
  errEl.hidden = true
  if (!name) return
  const res = await fetch('/api/slots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    errEl.textContent = body.error ?? `Failed to create slot (${res.status})`
    errEl.hidden = false
    return
  }
  document.getElementById('add-slot-form').hidden = true
  document.getElementById('slot-name-input').value = ''
  fetchSlots()
})

// ============================================================
// User management (admin only)
// ============================================================
async function fetchUsers() {
  const res = await fetch('/api/users')
  if (!res.ok) { console.error('fetchUsers failed', res.status, await res.text()); return }
  renderUsers(await res.json())
}

function renderUsers(users) {
  const tbody = document.getElementById('users-tbody')
  tbody.innerHTML = ''
  for (const u of users) {
    const tr = document.createElement('tr')
    tr.innerHTML = `
      <td>${u.email}</td>
      <td><span class="role-badge role-${u.role}">${u.role}</span></td>
      <td>${new Date(u.created_at).toLocaleDateString()}</td>
      <td><button class="btn-pill delete-user-btn" data-id="${u.id}">Delete</button></td>
    `
    tbody.appendChild(tr)
  }
  tbody.querySelectorAll('.delete-user-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this user?')) return
      await fetch(`/api/users/${btn.dataset.id}`, { method: 'DELETE' })
      fetchUsers()
    })
  })
}

document.getElementById('add-user-btn')?.addEventListener('click', () => {
  document.getElementById('add-user-form').hidden = false
})
document.getElementById('user-cancel')?.addEventListener('click', () => {
  document.getElementById('add-user-form').hidden = true
})
document.getElementById('user-submit')?.addEventListener('click', async () => {
  const email = document.getElementById('user-email-input').value.trim()
  const password = document.getElementById('user-password-input').value
  const role = document.getElementById('user-role-select').value
  const errEl = document.getElementById('user-form-error')
  errEl.hidden = true
  if (!email || !password) { errEl.textContent = 'Email and password are required'; errEl.hidden = false; return }
  const res = await fetch('/api/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, role }),
  })
  if (!res.ok) { errEl.textContent = (await res.json()).error ?? 'Failed to create user'; errEl.hidden = false; return }
  document.getElementById('add-user-form').hidden = true
  document.getElementById('user-email-input').value = ''
  document.getElementById('user-password-input').value = ''
  fetchUsers()
})

// Intercept 401 responses globally — redirect to login
const _origFetch = window.fetch
window.fetch = async (...args) => {
  const res = await _origFetch(...args)
  if (res.status === 401) window.location.href = '/login'
  return res
}

initSession()
