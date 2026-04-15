// ===== RemoteCamera Dashboard =====
// Viewer (answerer) role. Connects to the signaling server, lists cameras,
// and sets up WebRTC peer connections to receive video streams.

// SERVER_URL auto-detects based on current page protocol and host.
// Works on LAN (ws://) and in production (wss://) with no manual changes.
// Override by setting window.SERVER_URL_OVERRIDE before this script loads.
const SERVER_URL = window.SERVER_URL_OVERRIDE ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
// Public Google STUN server for NAT traversal on local networks
const STUN_SERVER = 'stun:stun.l.google.com:19302';

// ----- State -----
// camId -> { status: 'idle'|'connecting'|'live'|'offline'|'error', pc: RTCPeerConnection|null, dimmed: boolean }
const cameras = {};

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

    case 'lock-state':
      handleLockState(msg.camId, msg.locked);
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
      cameras[camId] = { status: 'idle', pc: null, dimmed: locked, removeTimer: null };
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

  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVER }] });
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

  pc.ontrack = ({ streams }) => {
    const card = getCardEl(camId);
    if (!card) return;
    const video = card.querySelector('video');
    if (video && streams[0]) {
      video.srcObject = streams[0];
    }
    cam.status = 'live';
    updateCardStatus(camId, 'live');
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    console.log(`[pc:${camId}] state =`, state);
    if (state === 'failed' || state === 'disconnected' || state === 'closed') {
      if (cameras[camId] && cameras[camId].status !== 'offline') {
        cam.status = 'error';
        updateCardStatus(camId, 'error');
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
  const dimmedBadge = card.querySelector('.dimmed-badge');
  const dimBtn = card.querySelector('.dim-btn');
  const isCollapsed = card.dataset.collapsed === 'true';

  if (dimmedBadge) {
    // In collapsed mode the badge is always shown and acts as the dim toggle
    dimmedBadge.hidden = isCollapsed ? false : !locked;
    dimmedBadge.textContent = locked ? 'Dimmed' : (isCollapsed ? 'Dim' : 'Dimmed');
    dimmedBadge.dataset.locked = locked ? 'true' : 'false';
    dimmedBadge.dataset.interactive = isCollapsed ? 'true' : 'false';
  }
  if (dimBtn) {
    dimBtn.textContent = locked ? 'Undim' : 'Dim';
    dimBtn.dataset.locked = locked ? 'true' : 'false';
  }
}

function toggleCollapse(card, camId) {
  const collapsed = card.dataset.collapsed === 'true';
  card.dataset.collapsed = collapsed ? 'false' : 'true';
  const collapseBtn = card.querySelector('.collapse-btn');
  collapseBtn.setAttribute('aria-label', collapsed ? 'Collapse camera card' : 'Expand camera card');
  // Sync dim badge interactive state with new collapsed state
  const cam = cameras[camId];
  if (cam) updateDimState(camId, cam.dimmed ?? false);
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

  const dimBtn = node.querySelector('.dim-btn');
  dimBtn.addEventListener('click', () => {
    const locked = dimBtn.dataset.locked !== 'true';
    remoteDim(camId, locked);
  });

  const dimmedBadge = node.querySelector('.dimmed-badge');
  dimmedBadge.addEventListener('click', () => {
    if (node.dataset.collapsed === 'true') {
      const locked = dimmedBadge.dataset.locked !== 'true';
      remoteDim(camId, locked);
    }
  });

  const collapseBtn = node.querySelector('.collapse-btn');
  collapseBtn.addEventListener('click', () => toggleCollapse(node, camId));

  const fsBtn = node.querySelector('.fullscreen-btn');
  const video = node.querySelector('video');
  fsBtn.addEventListener('click', () => toggleFullscreen(video));

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

  // Hide dim/fullscreen by default; shown only when live
  card.querySelector('.dim-btn').hidden = true;
  card.querySelector('.fullscreen-btn').hidden = true;

  if (status === 'offline') {
    // Show retry full-width to allow rejoin once camera returns
    viewBtn.hidden = true;
    retryBtn.hidden = false;
    retryBtn.textContent = 'Reconnect';
    retryBtn.style.flex = '1';
    retryBtn.disabled = true; // can't reconnect until camera-list says so
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
    card.querySelector('.dim-btn').hidden = false;
    card.querySelector('.fullscreen-btn').hidden = false;
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
    connecting: 'Connecting',
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

// Bootstrap
refreshEmptyState();
connect();
