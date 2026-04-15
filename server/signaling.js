// signaling.js — WebSocket message routing for RemoteCamera.
// The server is a pure relay: it does not inspect WebRTC payloads,
// it only routes messages between cameras and viewers based on ids.

// cameras: camId → WebSocket
export const cameras = new Map()
// viewers: viewerId → { ws, subscribedCamId }
export const viewers = new Map()
// allClients: every connected WebSocket (cameras + viewers + dashboards before viewer-join)
export const allClients = new Set()
// cameraLockStates: camId → boolean (true = dimmed/locked)
export const cameraLockStates = new Map()

/**
 * Safely send a JSON payload on a WebSocket. Swallow errors —
 * a dead socket just means the peer is gone, not that we should crash.
 */
function send(ws, payload) {
  if (!ws) return
  // ws.OPEN === 1
  if (ws.readyState !== 1) return
  try {
    ws.send(JSON.stringify(payload))
  } catch (err) {
    console.warn('[signaling] send failed:', err?.message)
  }
}

/**
 * Broadcast the current camera list to every connected viewer.
 */
export function broadcastCameraList() {
  const payload = {
    type: 'camera-list',
    cameras: Array.from(cameras.keys()).map((id) => ({
      id,
      locked: cameraLockStates.get(id) ?? false,
    })),
  }
  for (const ws of allClients) {
    send(ws, payload)
  }
}

/**
 * Entry point for every parsed WebSocket message.
 * Tags the `ws` with role/id so cleanup() can find it later.
 */
export function handleMessage(ws, msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    console.warn('[signaling] ignoring malformed message (no type)')
    return
  }

  switch (msg.type) {
    case 'register':
      return handleRegister(ws, msg)
    case 'viewer-join':
      return handleViewerJoin(ws, msg)
    case 'offer':
      return handleOffer(ws, msg)
    case 'answer':
      return handleAnswer(ws, msg)
    case 'ice-candidate':
      return handleIceCandidate(ws, msg)
    case 'lock-state':
      return handleLockState(ws, msg)
    case 'remote-lock':
      return handleRemoteLock(ws, msg)
    default:
      console.warn(`[signaling] unknown message type: ${msg.type}`)
  }
}

function handleRegister(ws, msg) {
  const { camId } = msg
  if (!camId) {
    console.warn('[signaling] register missing camId')
    return
  }

  // If camId is already registered, replace the old socket and warn.
  if (cameras.has(camId)) {
    console.warn(`[signaling] camera ${camId} already registered — replacing`)
    const oldWs = cameras.get(camId)
    if (oldWs && oldWs !== ws) {
      try { oldWs.close() } catch {}
    }
  }

  ws._role = 'camera'
  ws._id = camId
  cameras.set(camId, ws)
  console.log(`[signaling] camera registered: ${camId}`)

  broadcastCameraList()
}

function handleViewerJoin(ws, msg) {
  const { camId, viewerId } = msg
  if (!viewerId) {
    console.warn('[signaling] viewer-join missing viewerId')
    return
  }

  ws._role = 'viewer'
  ws._id = viewerId
  viewers.set(viewerId, { ws, subscribedCamId: camId })
  console.log(`[signaling] viewer joined: ${viewerId} → cam ${camId}`)

  // Always send the current camera list to this viewer on join.
  send(ws, { type: 'camera-list', cameras: Array.from(cameras.keys()) })

  const camWs = cameras.get(camId)
  if (!camWs) {
    send(ws, { type: 'error', message: 'camera-not-found' })
    return
  }

  send(camWs, { type: 'request-offer', viewerId })
}

function handleOffer(ws, msg) {
  const { targetId } = msg
  const target = viewers.get(targetId)
  if (!target) {
    console.warn(`[signaling] offer target viewer not found: ${targetId}`)
    return
  }
  send(target.ws, {
    type: 'offer',
    offer: msg.offer,
    camId: msg.camId,
  })
}

function handleAnswer(ws, msg) {
  const { targetId } = msg
  const camWs = cameras.get(targetId)
  if (!camWs) {
    console.warn(`[signaling] answer target camera not found: ${targetId}`)
    return
  }
  send(camWs, {
    type: 'answer',
    answer: msg.answer,
    viewerId: msg.viewerId,
  })
}

function handleIceCandidate(ws, msg) {
  const { targetId } = msg
  if (!targetId) {
    console.warn('[signaling] ice-candidate missing targetId')
    return
  }

  // targetId could be a viewerId or a camId — check both maps.
  const viewer = viewers.get(targetId)
  if (viewer) {
    send(viewer.ws, {
      type: 'ice-candidate',
      candidate: msg.candidate,
      camId: msg.camId,
    })
    return
  }

  const camWs = cameras.get(targetId)
  if (camWs) {
    send(camWs, {
      type: 'ice-candidate',
      candidate: msg.candidate,
      viewerId: msg.viewerId,
    })
    return
  }

  console.warn(`[signaling] ice-candidate target not found: ${targetId}`)
}

function handleLockState(ws, msg) {
  const { camId, locked } = msg
  if (!camId || typeof locked !== 'boolean') return
  cameraLockStates.set(camId, locked)
  // Broadcast updated lock state to all connected clients (dashboards)
  const payload = { type: 'lock-state', camId, locked }
  for (const client of allClients) {
    if (client !== ws) send(client, payload)
  }
}

function handleRemoteLock(ws, msg) {
  const { camId, locked } = msg
  if (!camId || typeof locked !== 'boolean') return
  const camWs = cameras.get(camId)
  if (!camWs) {
    console.warn(`[signaling] remote-lock: camera not found: ${camId}`)
    return
  }
  send(camWs, { type: 'remote-lock', locked })
}

/**
 * Remove a WebSocket from whichever registry owns it.
 * If a camera disconnects, notify all its subscribed viewers.
 */
export function cleanup(ws) {
  if (!ws || !ws._role) return

  if (ws._role === 'camera') {
    const camId = ws._id
    // Only remove if this socket is still the one registered
    // (a re-register might have replaced it already).
    if (cameras.get(camId) === ws) {
      cameras.delete(camId)
      cameraLockStates.delete(camId)
      console.log(`[signaling] camera disconnected: ${camId}`)

      // Notify any viewer subscribed to this camera.
      for (const { ws: vws, subscribedCamId } of viewers.values()) {
        if (subscribedCamId === camId) {
          send(vws, { type: 'camera-disconnected', id: camId })
        }
      }

      broadcastCameraList()
    }
  } else if (ws._role === 'viewer') {
    const viewerId = ws._id
    if (viewers.has(viewerId)) {
      viewers.delete(viewerId)
      console.log(`[signaling] viewer disconnected: ${viewerId}`)
    }
  }
}

/**
 * Test helper — clear all state. Not used in production.
 */
export function _resetState() {
  cameras.clear()
  viewers.clear()
  allClients.clear()
  cameraLockStates.clear()
}
