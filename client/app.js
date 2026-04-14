// RemoteCamera phone client
// =========================================================================
// CONFIG
// SERVER_URL auto-detects based on current page protocol and host.
// Works on LAN (ws://) and in production (wss://) with no manual changes.
// Override by setting window.SERVER_URL_OVERRIDE before this script loads.
const SERVER_URL = window.SERVER_URL_OVERRIDE ??
  `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;

// STUN server is used so peers can discover their public IP for NAT traversal.
// Google's public STUN server works for most home networks. Replace with your
// own STUN/TURN server if you need to support strict / symmetric NATs.
const STUN_SERVER = 'stun:stun.l.google.com:19302';
// =========================================================================

// Short random camera ID (e.g. "k3f9a2"). Shown to the user so they can
// tell the dashboard operator which camera to view.
const camId = Math.random().toString(36).slice(2, 8);

// State
let ws = null;
let pc = null;            // RTCPeerConnection
let localStream = null;
let viewerId = null;      // set when 'request-offer' arrives
let pendingRemoteIce = []; // ICE candidates received before remote description set

// DOM
const camIdDisplay = document.getElementById('camIdDisplay');
const previewVideo = document.getElementById('preview');
const placeholder = document.getElementById('videoPlaceholder');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const statusEl = document.getElementById('status');
const errorBox = document.getElementById('errorBox');

camIdDisplay.textContent = camId;

// ---------- UI helpers ----------
function setStatus(state) {
  statusEl.textContent = state;
  statusEl.className = 'status-value status-' + state;
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.hidden = false;
  setStatus('error');
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = '';
}

// ---------- Main entry: button click ----------
// IMPORTANT: getUserMedia must be triggered by a user gesture (Safari).
startBtn.addEventListener('click', async () => {
  clearError();
  startBtn.disabled = true;
  setStatus('connecting');

  // Check for secure context — Chrome hides mediaDevices on plain HTTP unless
  // the origin is flagged as secure in chrome://flags.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showError('Camera API unavailable. In Chrome, go to chrome://flags, enable "Insecure origins treated as secure", add http://10.132.110.75:3001, then tap Relaunch.');
    startBtn.disabled = false;
    return;
  }

  try {
    // 1) Camera permission — must come from this click handler.
    // Try rear camera first; fall back to any camera if the constraint fails
    // (Samsung Internet and some Android browsers reject facingMode constraints).
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
    } catch {
      localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    }
  } catch (err) {
    console.error('getUserMedia failed', err);
    showError('Camera error: ' + (err.name || '') + ' — ' + (err.message || err));
    startBtn.disabled = false;
    return;
  }

  // Show the preview so the user sees what is being captured.
  previewVideo.srcObject = localStream;
  placeholder.hidden = true;
  // Safari sometimes refuses autoplay even on muted; nudge it.
  try { await previewVideo.play(); } catch (_) { /* ignored */ }

  // 2) Open WebSocket and register.
  connectWebSocket();

  startBtn.hidden = true;
  stopBtn.hidden = false;
});

stopBtn.addEventListener('click', () => {
  teardown('idle');
});

// ---------- WebSocket ----------
function connectWebSocket() {
  try {
    ws = new WebSocket(SERVER_URL);
  } catch (err) {
    showError('Cannot connect to server — check the URL (' + SERVER_URL + ').');
    return;
  }

  ws.addEventListener('open', () => {
    console.log('[ws] open — registering camera', camId);
    send({ type: 'register', camId });
    setStatus('connecting');
  });

  ws.addEventListener('error', (e) => {
    console.error('[ws] error', e);
    showError('WebSocket error — cannot reach server at ' + SERVER_URL);
  });

  ws.addEventListener('close', () => {
    console.warn('[ws] closed');
    if (statusEl.textContent !== 'error' && statusEl.textContent !== 'idle') {
      showError('Connection to server lost. Tap Stop and try again.');
    }
  });

  ws.addEventListener('message', async (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); }
    catch (e) { console.warn('[ws] non-JSON message', evt.data); return; }

    console.log('[ws] <-', msg.type, msg);

    switch (msg.type) {
      case 'request-offer':
        await handleRequestOffer(msg.viewerId);
        break;
      case 'answer':
        await handleAnswer(msg);
        break;
      case 'ice-candidate':
        await handleRemoteIce(msg);
        break;
      default:
        console.log('[ws] ignored message type', msg.type);
    }
  });
}

function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[ws] cannot send, socket not open', obj);
    return;
  }
  ws.send(JSON.stringify(obj));
}

// ---------- WebRTC (camera = offerer) ----------
async function handleRequestOffer(incomingViewerId) {
  viewerId = incomingViewerId;
  try {
    pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_SERVER }] });

    // Add all local tracks (video only here).
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        send({
          type: 'ice-candidate',
          candidate,
          camId,
          targetId: viewerId,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[pc] connectionState =', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatus('live');
      } else if (pc.connectionState === 'failed') {
        showError('Stream failed — please refresh.');
      } else if (pc.connectionState === 'disconnected') {
        setStatus('connecting');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[pc] iceConnectionState =', pc.iceConnectionState);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    send({
      type: 'offer',
      offer,
      camId,
      targetId: viewerId,
    });
  } catch (err) {
    console.error('WebRTC offer failed', err);
    showError('Could not start the video stream: ' + (err && err.message ? err.message : err));
  }
}

async function handleAnswer(msg) {
  if (!pc) {
    console.warn('Got answer but no peer connection');
    return;
  }
  try {
    await pc.setRemoteDescription(msg.answer);
    // Flush any ICE candidates that arrived before the answer.
    for (const c of pendingRemoteIce) {
      try { await pc.addIceCandidate(c); }
      catch (e) { console.warn('addIceCandidate (flushed) failed', e); }
    }
    pendingRemoteIce = [];
  } catch (err) {
    console.error('setRemoteDescription failed', err);
    showError('Failed to complete WebRTC handshake.');
  }
}

async function handleRemoteIce(msg) {
  const candidate = msg.candidate;
  if (!candidate) return;
  if (!pc || !pc.remoteDescription) {
    // Buffer until remote description is set.
    pendingRemoteIce.push(candidate);
    return;
  }
  try {
    await pc.addIceCandidate(candidate);
  } catch (err) {
    console.warn('addIceCandidate failed', err);
  }
}

// ---------- Teardown ----------
function teardown(finalState) {
  try { if (pc) pc.close(); } catch (_) {}
  pc = null;
  viewerId = null;
  pendingRemoteIce = [];

  try { if (ws) ws.close(); } catch (_) {}
  ws = null;

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }

  previewVideo.srcObject = null;
  placeholder.hidden = false;

  startBtn.hidden = false;
  startBtn.disabled = false;
  stopBtn.hidden = true;

  if (finalState) setStatus(finalState);
}

// Clean up when the page is closed.
window.addEventListener('pagehide', () => teardown());
