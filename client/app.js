// RemoteCamera phone client
// =========================================================================
// CONFIG
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
// =========================================================================

// Read slot code from URL ?code= parameter; redirect to /login if missing.
const urlParams = new URLSearchParams(window.location.search)
const slotCode = urlParams.get('code')
if (!slotCode) {
  window.location.href = '/login'
}
let camId = null  // set after server confirms registration

// State
let ws = null;
let pc = null;            // RTCPeerConnection
let localStream = null;
let viewerId = null;      // set when 'request-offer' arrives
let pendingRemoteIce = []; // ICE candidates received before remote description set

// Recording state
let recordingManager = null;
let autoRecordEnabled = false;
let autoRecordDurationMs = 5000;
let autoRecordStopTimer = null;

// DOM
const camIdDisplay = document.getElementById('camIdDisplay');
const previewVideo = document.getElementById('preview');
const placeholder = document.getElementById('videoPlaceholder');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const lockBtn = document.getElementById('lockBtn');
const lockOverlay = document.getElementById('lockOverlay');
const statusEl = document.getElementById('status');
const errorBox = document.getElementById('errorBox');
const motionControls = document.getElementById('motionControls');
const sensitivitySlider = document.getElementById('sensitivitySlider');
const sensitivityValue = document.getElementById('sensitivityValue');
const motionIndicator = document.getElementById('motionIndicator');

// Recording DOM
const recordingControls = document.getElementById('recordingControls');
const recordBtn = document.getElementById('recordBtn');
const recordingIndicator = document.getElementById('recordingIndicator');
const recTimer = document.getElementById('recTimer');
const uploadStatus = document.getElementById('uploadStatus');
const autoRecordToggle = document.getElementById('autoRecordToggle');
const autoRecordDurationInput = document.getElementById('autoRecordDuration');

// AI detection DOM
const aiStatusEl = document.getElementById('aiStatus');
const aiDetectedRow = document.getElementById('aiDetectedRow');
const aiDetectedList = document.getElementById('aiDetectedList');
const aiIntervalRow = document.getElementById('aiIntervalRow');
const detectionIntervalSlider = document.getElementById('detectionIntervalSlider');
const detectionIntervalValueEl = document.getElementById('detectionIntervalValue');
const detectionCaptureCanvas = document.getElementById('detectionCaptureCanvas');
const detectionOverlayCanvas = document.getElementById('detectionOverlay');

if (camIdDisplay) camIdDisplay.textContent = 'Connecting…'

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

  // Start motion detection once the video has metadata (dimensions known).
  previewVideo.addEventListener('loadedmetadata', startMotionDetection, { once: true });
  // If metadata is already available (e.g. replay), start immediately.
  if (previewVideo.readyState >= 1) startMotionDetection();

  // 2) Open WebSocket and register.
  connectWebSocket();

  // 3) Init recording manager with the live stream.
  initRecordingManager();

  // 4) Kick off TF.js object detection (model load + detection loop).
  //    Failures here must not break streaming/recording.
  startObjectDetection().catch((err) => {
    console.warn('[ai] object detection failed to start', err);
  });

  startBtn.hidden = true;
  stopBtn.hidden = false;
  lockBtn.hidden = false;
  motionControls.hidden = false;
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
    console.log('[ws] open — registering with code', slotCode);
    send({ type: 'register', code: slotCode });
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
      case 'remote-lock':
        if (msg.locked) activateLock(); else deactivateLock();
        break;
      case 'set-sensitivity':
        if (typeof msg.sensitivity === 'number') {
          motionSensitivity = msg.sensitivity;
          sensitivitySlider.value = motionSensitivity;
          sensitivityValue.textContent = motionSensitivity;
        }
        break;
      case 'recording-start':
        if (recordingManager && !recordingManager.isRecording) {
          recordingManager.start();
        }
        break;
      case 'recording-stop':
        if (recordingManager && recordingManager.isRecording) {
          recordingManager.stop();
        }
        break;
      case 'registered':
        camId = msg.slotId
        if (camIdDisplay) camIdDisplay.textContent = msg.slotName ?? msg.slotId
        break
      case 'error':
        if (msg.message === 'invalid-code' || msg.message === 'missing-code') {
          window.location.href = '/login'
        }
        break
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
    const iceServers = await getIceServers()
    pc = new RTCPeerConnection({ iceServers });

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

    // iceConnectionState is more reliable on iOS WebKit than connectionState.
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      console.log('[pc] iceConnectionState =', state);
      if (state === 'connected' || state === 'completed') {
        setStatus('live');
      } else if (state === 'failed') {
        showError('Stream failed — ICE connection failed. Check network or try again.');
      } else if (state === 'disconnected') {
        setStatus('connecting');
      }
    };

    // connectionState as secondary fallback (not always reliable on iOS)
    pc.onconnectionstatechange = () => {
      console.log('[pc] connectionState =', pc.connectionState);
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

// ---------- Recording ----------
class RecordingManager {
  constructor(stream) {
    this.stream = stream;
    this.mediaRecorder = null;
    this.chunks = [];
    this.startTime = null;
    this.timerInterval = null;
    this.isRecording = false;

    // Determine best supported mimeType
    const mimeTypes = [
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    this.mimeType = mimeTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  }

  start() {
    if (this.isRecording) return;
    this.chunks = [];
    this.startTime = new Date().toISOString();

    const options = { videoBitsPerSecond: 1_000_000 };
    if (this.mimeType) options.mimeType = this.mimeType;

    try {
      this.mediaRecorder = new MediaRecorder(this.stream, options);
    } catch (err) {
      console.error('[rec] MediaRecorder init failed', err);
      return;
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.chunks, {
        type: this.mimeType || 'video/webm',
      });
      const duration = Date.now() - new Date(this.startTime).getTime();
      this._upload(blob, this.startTime, duration);
    };

    this.mediaRecorder.start(1000); // collect chunks every 1s
    this.isRecording = true;
    this._startTimer();
    this._updateUI(true);
    send({ type: 'recording-status', camId, recording: true });
  }

  stop() {
    if (!this.isRecording) return;
    this.isRecording = false;
    this._stopTimer();
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this._updateUI(false);
    send({ type: 'recording-status', camId, recording: false });
  }

  _startTimer() {
    const startMs = Date.now();
    recTimer.textContent = '00:00';
    recordingIndicator.hidden = false;
    this.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const ss = String(elapsed % 60).padStart(2, '0');
      recTimer.textContent = `${mm}:${ss}`;
    }, 1000);
  }

  _stopTimer() {
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    recordingIndicator.hidden = true;
    recTimer.textContent = '00:00';
  }

  _updateUI(recording) {
    if (recording) {
      recordBtn.textContent = 'Stop Recording';
      recordBtn.classList.add('recording');
    } else {
      recordBtn.textContent = 'Record';
      recordBtn.classList.remove('recording');
    }
  }

  async _upload(blob, startTime, duration) {
    uploadStatus.textContent = 'Uploading\u2026';
    uploadStatus.className = 'upload-status uploading';
    uploadStatus.hidden = false;

    try {
      const form = new FormData();
      form.append('video', blob, 'recording.webm');
      form.append('slotId', camId);
      form.append('startTime', startTime);
      form.append('duration', String(duration));

      const res = await fetch('/api/recordings/upload', {
        method: 'POST',
        body: form,
      });

      if (res.ok) {
        uploadStatus.textContent = 'Saved \u2713';
        uploadStatus.className = 'upload-status saved';
      } else {
        const body = await res.json().catch(() => ({}));
        throw new Error(`HTTP ${res.status}: ${body.error ?? ''} ${body.detail ?? ''}`.trim());
      }
    } catch (err) {
      console.error('[rec] upload failed', err);
      uploadStatus.textContent = 'Upload failed';
      uploadStatus.className = 'upload-status failed';
    }

    // Hide upload status after 4 seconds
    setTimeout(() => {
      uploadStatus.hidden = true;
      uploadStatus.textContent = '';
      uploadStatus.className = 'upload-status';
    }, 4000);
  }

  destroy() {
    if (this.isRecording) this.stop();
    this._stopTimer();
  }
}

function initRecordingManager() {
  if (!localStream) return;
  recordingManager = new RecordingManager(localStream);
  recordingControls.hidden = false;
}

function destroyRecordingManager() {
  clearTimeout(autoRecordStopTimer);
  autoRecordStopTimer = null;
  if (recordingManager) {
    recordingManager.destroy();
    recordingManager = null;
  }
  recordingControls.hidden = true;
  recordingIndicator.hidden = true;
  uploadStatus.hidden = true;
  recordBtn.textContent = 'Record';
  recordBtn.classList.remove('recording');
}

recordBtn.addEventListener('click', () => {
  if (!recordingManager) return;
  if (recordingManager.isRecording) {
    recordingManager.stop();
  } else {
    recordingManager.start();
  }
});

autoRecordToggle.addEventListener('change', () => {
  autoRecordEnabled = autoRecordToggle.checked;
});

autoRecordDurationInput.addEventListener('change', () => {
  const secs = Math.max(1, Math.min(300, Number(autoRecordDurationInput.value) || 5));
  autoRecordDurationInput.value = secs;
  autoRecordDurationMs = secs * 1000;
});

function triggerAutoRecord() {
  if (!autoRecordEnabled || !recordingManager) return;
  if (!recordingManager.isRecording) {
    recordingManager.start();
  }
  // Extend (debounce) the stop timer on every motion event
  clearTimeout(autoRecordStopTimer);
  autoRecordStopTimer = setTimeout(() => {
    if (recordingManager && recordingManager.isRecording) recordingManager.stop();
  }, autoRecordDurationMs);
}

// ---------- Teardown ----------
function teardown(finalState) {
  destroyRecordingManager();

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

  stopMotionDetection();
  stopObjectDetection();

  previewVideo.srcObject = null;
  placeholder.hidden = false;

  startBtn.hidden = false;
  startBtn.disabled = false;
  stopBtn.hidden = true;
  lockBtn.hidden = true;
  motionControls.hidden = true;
  motionIndicator.hidden = true;
  deactivateLock();

  if (finalState) setStatus(finalState);
}

// Clean up when the page is closed.
window.addEventListener('pagehide', () => teardown());

// ---------- Motion Detection ----------
const MOTION_W = 160;
const MOTION_H = 90;
const PIXEL_DELTA_THRESHOLD = 30;   // per-channel difference to count as changed
const MOTION_INTERVAL_MS = 200;
const MOTION_COOLDOWN_MS = 2000;

let motionCanvas = null;
let motionCtx = null;
let motionPrevData = null;
let motionInterval = null;
let motionCooldown = false;
let motionSensitivity = 20;

sensitivitySlider.addEventListener('input', () => {
  motionSensitivity = Number(sensitivitySlider.value);
  sensitivityValue.textContent = motionSensitivity;
});

function onMotionDetected(cameraId, timestamp) {
  send({ type: 'motion', camId: cameraId, timestamp });
  triggerAutoRecord();
}

function startMotionDetection() {
  if (motionInterval) return;
  motionCanvas = document.createElement('canvas');
  motionCanvas.width = MOTION_W;
  motionCanvas.height = MOTION_H;
  motionCtx = motionCanvas.getContext('2d', { willReadFrequently: true });
  motionPrevData = null;

  motionInterval = setInterval(() => {
    if (!localStream || previewVideo.readyState < 2) return;
    motionCtx.drawImage(previewVideo, 0, 0, MOTION_W, MOTION_H);
    const frame = motionCtx.getImageData(0, 0, MOTION_W, MOTION_H);

    if (motionPrevData) {
      const changed = countChangedPixels(frame.data, motionPrevData);
      const changedPct = (changed / (MOTION_W * MOTION_H)) * 100;
      // sensitivity 0 → threshold 5% (hard to trigger)
      // sensitivity 100 → threshold 0.1% (very easy to trigger)
      const threshold = Math.max(0.1, (100 - motionSensitivity) * 0.05);

      if (changedPct > threshold && !motionCooldown) {
        motionCooldown = true;
        setTimeout(() => { motionCooldown = false; }, MOTION_COOLDOWN_MS);
        flashMotionIndicator();
        onMotionDetected(camId, Date.now());
      }
    }

    motionPrevData = frame.data.slice();
  }, MOTION_INTERVAL_MS);
}

function countChangedPixels(curr, prev) {
  let count = 0;
  for (let i = 0; i < curr.length; i += 4) {
    if (
      Math.abs(curr[i]   - prev[i])   > PIXEL_DELTA_THRESHOLD ||
      Math.abs(curr[i+1] - prev[i+1]) > PIXEL_DELTA_THRESHOLD ||
      Math.abs(curr[i+2] - prev[i+2]) > PIXEL_DELTA_THRESHOLD
    ) count++;
  }
  return count;
}

function stopMotionDetection() {
  clearInterval(motionInterval);
  motionInterval = null;
  motionPrevData = null;
  motionCanvas = null;
  motionCtx = null;
  motionCooldown = false;
}

function flashMotionIndicator() {
  motionIndicator.hidden = false;
  setTimeout(() => { motionIndicator.hidden = true; }, 1500);
}

// ---------- Lock screen ----------
let wakeLock = null;

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) { /* permission denied or not supported */ }
}

function releaseWakeLock() {
  if (wakeLock) { wakeLock.release(); wakeLock = null; }
}

// Re-acquire wake lock when the page becomes visible again (iOS/Android release
// it automatically when the app goes to background).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && lockOverlay && !lockOverlay.hidden) {
    acquireWakeLock();
  }
});

function activateLock() {
  lockOverlay.hidden = false;
  acquireWakeLock();
  send({ type: 'lock-state', camId, locked: true });
}

function deactivateLock() {
  lockOverlay.hidden = true;
  releaseWakeLock();
  send({ type: 'lock-state', camId, locked: false });
}

lockBtn.addEventListener('click', activateLock);

// (x) button — fallback for desktop
document.getElementById('lockClose').addEventListener('click', deactivateLock);

// Touch: swipe up ≥60px to unlock (mobile)
let touchStartY = 0;
lockOverlay.addEventListener('touchstart', (e) => {
  touchStartY = e.touches[0].clientY;
}, { passive: true });

lockOverlay.addEventListener('touchend', (e) => {
  const delta = touchStartY - e.changedTouches[0].clientY;
  if (delta > 60) deactivateLock();
}, { passive: true });

// Mouse: click-and-drag up ≥60px to unlock (desktop)
let mouseStartY = 0;
lockOverlay.addEventListener('mousedown', (e) => {
  mouseStartY = e.clientY;
});

lockOverlay.addEventListener('mouseup', (e) => {
  const delta = mouseStartY - e.clientY;
  if (delta > 60) deactivateLock();
});

// ---------- AI / TensorFlow.js object detection ----------
// Uses COCO-SSD via globally loaded `cocoSsd` (script tag in index.html).
// Detection failures must never break streaming/recording.

const TRACKED_CLASSES = new Set([
  'person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle',
  'cat', 'dog', 'bird', 'horse',
]);
const VEHICLE_CLASSES = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle']);
const ANIMAL_CLASSES  = new Set(['cat', 'dog', 'bird', 'horse', 'cow', 'sheep']);
const DETECTION_MIN_CONFIDENCE = 0.5;

let detectionModel = null;
let detectionIntervalMs = 2000;
let detectionTimer = null;
let detectionInFlight = false;
let detectionLoading = false;
let lastDetectionResults = [];

if (detectionIntervalSlider) {
  detectionIntervalMs = Number(detectionIntervalSlider.value) || 2000;
  detectionIntervalValueEl.textContent = (detectionIntervalMs / 1000).toFixed(1) + 's';
  detectionIntervalSlider.addEventListener('input', () => {
    detectionIntervalMs = Number(detectionIntervalSlider.value) || 2000;
    detectionIntervalValueEl.textContent = (detectionIntervalMs / 1000).toFixed(1) + 's';
    // Restart loop with new interval if currently running.
    if (detectionTimer) {
      clearInterval(detectionTimer);
      detectionTimer = setInterval(runDetectionTick, detectionIntervalMs);
    }
  });
}

function setAiStatus(label, kind /* 'off' | 'loading' | 'active' | 'error' */) {
  if (!aiStatusEl) return;
  aiStatusEl.textContent = label;
  aiStatusEl.className = 'ai-status ai-status-' + kind;
}

function showAiIntervalControl(show) {
  if (aiIntervalRow) aiIntervalRow.hidden = !show;
}

async function loadDetectionModel() {
  if (detectionModel) return detectionModel;
  if (typeof cocoSsd === 'undefined' || !cocoSsd || typeof cocoSsd.load !== 'function') {
    console.warn('[ai] cocoSsd is not available — TF.js scripts may have failed to load');
    setAiStatus('Unavailable', 'error');
    return null;
  }
  detectionLoading = true;
  setAiStatus('Loading…', 'loading');
  try {
    detectionModel = await cocoSsd.load();
    console.log('[ai] COCO-SSD model loaded');
    return detectionModel;
  } catch (err) {
    console.warn('[ai] failed to load COCO-SSD model', err);
    setAiStatus('Error', 'error');
    return null;
  } finally {
    detectionLoading = false;
  }
}

async function startObjectDetection() {
  // Only run when streaming is active.
  if (!localStream) return;

  showAiIntervalControl(true);

  const model = await loadDetectionModel();
  if (!model) {
    // Already showed status (Unavailable/Error). Skip starting the loop.
    return;
  }

  // Wait for video metadata if needed so we know frame dimensions.
  if (previewVideo.readyState < 2) {
    await new Promise((resolve) => {
      previewVideo.addEventListener('loadeddata', resolve, { once: true });
    });
  }

  setAiStatus('Active', 'active');
  if (aiDetectedRow) aiDetectedRow.hidden = false;

  // Kick off the periodic detection loop.
  if (detectionTimer) clearInterval(detectionTimer);
  detectionTimer = setInterval(runDetectionTick, detectionIntervalMs);
  // Also run once immediately so the user sees feedback fast.
  runDetectionTick();
}

function stopObjectDetection() {
  if (detectionTimer) {
    clearInterval(detectionTimer);
    detectionTimer = null;
  }
  detectionInFlight = false;
  lastDetectionResults = [];
  clearDetectionOverlay();
  if (aiDetectedRow) aiDetectedRow.hidden = true;
  if (aiDetectedList) aiDetectedList.textContent = '—';
  showAiIntervalControl(false);
  setAiStatus('Off', 'off');
}

async function runDetectionTick() {
  if (detectionInFlight) return;
  if (!detectionModel) return;
  if (!localStream) return;
  // Skip while document is hidden — saves battery and avoids stale frames.
  if (document.hidden) return;
  if (previewVideo.readyState < 2) return;

  const vw = previewVideo.videoWidth;
  const vh = previewVideo.videoHeight;
  if (!vw || !vh) return;

  detectionInFlight = true;
  try {
    // Capture current frame onto the hidden canvas at the video's native size.
    if (detectionCaptureCanvas.width !== vw) detectionCaptureCanvas.width = vw;
    if (detectionCaptureCanvas.height !== vh) detectionCaptureCanvas.height = vh;
    const ctx = detectionCaptureCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(previewVideo, 0, 0, vw, vh);

    const raw = await detectionModel.detect(detectionCaptureCanvas);

    // Filter to >= 0.5 confidence (server applies per-slot rules separately).
    const filtered = (raw || []).filter((d) => (d && typeof d.score === 'number' && d.score >= DETECTION_MIN_CONFIDENCE));

    // Normalize shape for the wire: { class, score, bbox: [x,y,w,h] }
    const payload = filtered.map((d) => ({
      class: d.class,
      score: d.score,
      bbox: Array.isArray(d.bbox) ? d.bbox : [0, 0, 0, 0],
    }));

    lastDetectionResults = payload;
    drawDetectionOverlay(payload, vw, vh);
    updateDetectedClassesUi(payload);

    // Send to server when WS is open and registration is confirmed.
    if (camId && ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({
          type: 'detection-event',
          camId,
          detections: payload,
          timestamp: Date.now(),
        }));
      } catch (err) {
        console.warn('[ai] failed to send detection-event', err);
      }
    }
  } catch (err) {
    console.warn('[ai] detection tick failed', err);
  } finally {
    detectionInFlight = false;
  }
}

function updateDetectedClassesUi(detections) {
  if (!aiDetectedList) return;
  // Show a deduped list of tracked classes detected this cycle, with top score.
  const byClass = new Map();
  for (const d of detections) {
    if (!TRACKED_CLASSES.has(d.class)) continue;
    const prev = byClass.get(d.class) ?? 0;
    if (d.score > prev) byClass.set(d.class, d.score);
  }
  if (byClass.size === 0) {
    aiDetectedList.textContent = '—';
    return;
  }
  const parts = [];
  for (const [cls, score] of byClass) {
    parts.push(`${cls} ${(score * 100).toFixed(0)}%`);
  }
  aiDetectedList.textContent = parts.join(', ');
}

function colorForClass(cls) {
  if (cls === 'person') return '#ef4444';      // red
  if (VEHICLE_CLASSES.has(cls)) return '#3b82f6'; // blue
  if (ANIMAL_CLASSES.has(cls))  return '#22c55e'; // green
  return '#facc15';                              // yellow fallback
}

function clearDetectionOverlay() {
  if (!detectionOverlayCanvas) return;
  const ctx = detectionOverlayCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, detectionOverlayCanvas.width, detectionOverlayCanvas.height);
}

function drawDetectionOverlay(detections, sourceW, sourceH) {
  if (!detectionOverlayCanvas) return;
  // Match overlay to the displayed video element so boxes line up with what
  // the user sees (preview uses object-fit: cover).
  const rect = previewVideo.getBoundingClientRect();
  const cw = Math.max(1, Math.round(rect.width));
  const ch = Math.max(1, Math.round(rect.height));
  if (detectionOverlayCanvas.width !== cw) detectionOverlayCanvas.width = cw;
  if (detectionOverlayCanvas.height !== ch) detectionOverlayCanvas.height = ch;

  const ctx = detectionOverlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, cw, ch);

  // Compute object-fit: cover transform from source frame to displayed canvas.
  const scale = Math.max(cw / sourceW, ch / sourceH);
  const drawW = sourceW * scale;
  const drawH = sourceH * scale;
  const offX  = (cw - drawW) / 2;
  const offY  = (ch - drawH) / 2;

  ctx.lineWidth = 2;
  ctx.font = 'bold 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'top';

  for (const det of detections) {
    const [x, y, w, h] = det.bbox || [0, 0, 0, 0];
    const bx = offX + x * scale;
    const by = offY + y * scale;
    const bw = w * scale;
    const bh = h * scale;

    const color = colorForClass(det.class);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.strokeRect(bx, by, bw, bh);

    const label = `${det.class} ${(det.score * 100).toFixed(0)}%`;
    const padX = 4, padY = 2;
    const textW = ctx.measureText(label).width + padX * 2;
    const textH = 16;
    const labelY = by - textH >= 0 ? by - textH : by;
    ctx.fillRect(bx, labelY, textW, textH);
    ctx.fillStyle = '#0f172a';
    ctx.fillText(label, bx + padX, labelY + padY);
  }
}

// Pause/resume detection on tab visibility changes. We keep the timer running
// but the tick early-returns when document.hidden is true; this also avoids
// piling up promise rejections from an inactive tab.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Just clear current overlay; tick handler will skip running.
    clearDetectionOverlay();
  } else if (detectionModel && detectionTimer) {
    // Run a fresh tick when visible again.
    runDetectionTick();
  }
});
