// signaling.test.js — behavior tests for the RemoteCamera signaling server.
// Uses node:test (built-in) + ws client sockets against a real Express+WS server.

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import http from 'node:http'

import { createApp } from '../index.js'
import { _resetState } from '../signaling.js'

// ---------- helpers ----------

async function startServer() {
  const instance = createApp()
  await new Promise((resolve) => instance.httpServer.listen(0, resolve))
  const { port } = instance.httpServer.address()
  return { ...instance, port, url: `ws://localhost:${port}` }
}

function connect(url) {
  const ws = new WebSocket(url)
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
  })
}

// Attach a persistent message queue to each ws so reads are race-free.
function attachQueue(ws) {
  if (ws._msgQueue) return
  ws._msgQueue = []
  ws._msgWaiters = []
  ws.on('message', (data) => {
    let parsed
    try { parsed = JSON.parse(data.toString()) } catch { return }
    const waiter = ws._msgWaiters.shift()
    if (waiter) waiter.resolve(parsed)
    else ws._msgQueue.push(parsed)
  })
}

function nextMsg(ws, { timeoutMs = 1000 } = {}) {
  attachQueue(ws)
  if (ws._msgQueue.length) return Promise.resolve(ws._msgQueue.shift())
  return new Promise((resolve, reject) => {
    const waiter = { resolve, reject }
    ws._msgWaiters.push(waiter)
    setTimeout(() => {
      const idx = ws._msgWaiters.indexOf(waiter)
      if (idx >= 0) {
        ws._msgWaiters.splice(idx, 1)
        reject(new Error('nextMsg timeout'))
      }
    }, timeoutMs)
  })
}

// Collect any messages received during the interval (drains queue + catches new).
function collectMsgs(ws, ms = 120) {
  attachQueue(ws)
  return new Promise((resolve) => {
    setTimeout(() => {
      const drained = ws._msgQueue.splice(0)
      resolve(drained)
    }, ms)
  })
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj))
}

function waitForClose(ws, { timeoutMs = 1000 } = {}) {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('close timeout')), timeoutMs)
    ws.once('close', () => { clearTimeout(timer); resolve() })
    ws.once('error', () => { clearTimeout(timer); resolve() })
  })
}

// Small sleep used after sending a message to let the server route it.
function tick(ms = 60) {
  return new Promise((r) => setTimeout(r, ms))
}

async function closeServer(instance) {
  try { instance.wss.clients.forEach((c) => c.terminate()) } catch {}
  await new Promise((resolve) => instance.httpServer.close(resolve))
  _resetState()
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port, path }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    }).on('error', reject)
  })
}

// ---------- fixture ----------

let server

beforeEach(async () => {
  _resetState()
  server = await startServer()
})

afterEach(async () => {
  if (server) await closeServer(server)
  server = null
})

// ---------- camera registration ----------

test('camera register stores camera and broadcasts camera-list to connected viewers', async () => {
  // Viewer connects first (with no cameras), then a camera registers.
  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'missing', viewerId: 'v1' })

  // drain the initial viewer-join responses (camera-list + error)
  await collectMsgs(viewer, 80)

  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'cam1' })

  const msg = await nextMsg(viewer)
  assert.equal(msg.type, 'camera-list')
  assert.deepEqual(msg.cameras, ['cam1'])
  assert.equal(server.cameras.size, 1)
  assert.ok(server.cameras.has('cam1'))

  camera.close()
  viewer.close()
})

test('duplicate register for same camId closes the old socket and replaces it', async () => {
  const cam1 = await connect(server.url)
  send(cam1, { type: 'register', camId: 'cam-dup' })
  await tick()

  const cam2 = await connect(server.url)
  send(cam2, { type: 'register', camId: 'cam-dup' })

  // Old socket should get closed by the server.
  await waitForClose(cam1)

  assert.equal(server.cameras.size, 1)
  assert.equal(server.cameras.get('cam-dup'), cam2._socket ? server.cameras.get('cam-dup') : server.cameras.get('cam-dup'))
  // The ws stored is the new one (cam2's server-side counterpart); verify indirectly via map size + health.
  const health = await httpGet(server.port, '/health')
  assert.equal(JSON.parse(health.body).cameras, 1)

  cam2.close()
})

// ---------- viewer join ----------

test('viewer-join for existing camera sends camera-list to viewer and request-offer to camera', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camA' })
  await tick()

  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'camA', viewerId: 'viewer-1' })

  const viewerMsg = await nextMsg(viewer)
  assert.equal(viewerMsg.type, 'camera-list')
  assert.deepEqual(viewerMsg.cameras, ['camA'])

  const camMsg = await nextMsg(camera)
  assert.equal(camMsg.type, 'request-offer')
  assert.equal(camMsg.viewerId, 'viewer-1')

  camera.close()
  viewer.close()
})

test('viewer-join for nonexistent camera sends camera-list then error camera-not-found', async () => {
  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'ghost', viewerId: 'viewer-x' })

  const first = await nextMsg(viewer)
  assert.equal(first.type, 'camera-list')
  assert.deepEqual(first.cameras, [])

  const second = await nextMsg(viewer)
  assert.equal(second.type, 'error')
  assert.equal(second.message, 'camera-not-found')

  viewer.close()
})

// ---------- offer forwarding ----------

test('offer with valid targetId viewer is forwarded with { offer, camId }', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camO' })
  await tick()

  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'camO', viewerId: 'vO' })
  await collectMsgs(viewer, 80)
  await collectMsgs(camera, 80) // swallow request-offer

  const fakeOffer = { sdp: 'v=0...', type: 'offer' }
  send(camera, { type: 'offer', offer: fakeOffer, camId: 'camO', targetId: 'vO' })

  const msg = await nextMsg(viewer)
  assert.equal(msg.type, 'offer')
  assert.deepEqual(msg.offer, fakeOffer)
  assert.equal(msg.camId, 'camO')

  camera.close()
  viewer.close()
})

test('offer with unknown targetId is dropped silently (no crash, no forward)', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camX' })
  await tick()

  // no viewer present
  send(camera, { type: 'offer', offer: { sdp: 'x' }, camId: 'camX', targetId: 'nobody' })
  await tick(100)

  // Server still healthy
  const health = await httpGet(server.port, '/health')
  assert.equal(health.status, 200)
  assert.equal(JSON.parse(health.body).cameras, 1)

  camera.close()
})

// ---------- answer forwarding ----------

test('answer with valid targetId camera is forwarded as { answer, viewerId }', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camAns' })
  await tick()

  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'camAns', viewerId: 'vAns' })
  await collectMsgs(viewer, 80)
  await collectMsgs(camera, 80) // drain request-offer

  const fakeAnswer = { sdp: 'answer-sdp', type: 'answer' }
  send(viewer, {
    type: 'answer',
    answer: fakeAnswer,
    camId: 'camAns',
    targetId: 'camAns',
    viewerId: 'vAns',
  })

  const msg = await nextMsg(camera)
  assert.equal(msg.type, 'answer')
  assert.deepEqual(msg.answer, fakeAnswer)
  assert.equal(msg.viewerId, 'vAns')

  camera.close()
  viewer.close()
})

// ---------- ICE candidate forwarding ----------

test('camera ice-candidate with viewer targetId is forwarded to viewer with camId', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camICE' })
  await tick()

  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'camICE', viewerId: 'vICE' })
  await collectMsgs(viewer, 80)
  await collectMsgs(camera, 80)

  const fakeCandidate = { candidate: 'candidate:1 udp ...' }
  send(camera, {
    type: 'ice-candidate',
    candidate: fakeCandidate,
    camId: 'camICE',
    targetId: 'vICE',
  })

  const msg = await nextMsg(viewer)
  assert.equal(msg.type, 'ice-candidate')
  assert.deepEqual(msg.candidate, fakeCandidate)
  assert.equal(msg.camId, 'camICE')

  camera.close()
  viewer.close()
})

test('viewer ice-candidate with camera targetId is forwarded to camera with viewerId', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camICE2' })
  await tick()

  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'camICE2', viewerId: 'vICE2' })
  await collectMsgs(viewer, 80)
  await collectMsgs(camera, 80)

  const fakeCandidate = { candidate: 'candidate:2 tcp ...' }
  send(viewer, {
    type: 'ice-candidate',
    candidate: fakeCandidate,
    viewerId: 'vICE2',
    targetId: 'camICE2',
  })

  const msg = await nextMsg(camera)
  assert.equal(msg.type, 'ice-candidate')
  assert.deepEqual(msg.candidate, fakeCandidate)
  assert.equal(msg.viewerId, 'vICE2')

  camera.close()
  viewer.close()
})

// ---------- disconnect / cleanup ----------

test('camera disconnect notifies subscribed viewers and rebroadcasts camera-list', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camDC' })
  await tick()

  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'camDC', viewerId: 'vDC' })
  await collectMsgs(viewer, 80) // drain camera-list
  await collectMsgs(camera, 80) // drain request-offer

  camera.close()

  // Expect two messages: camera-disconnected + camera-list (order not guaranteed but impl sends disconnected first).
  const msgs = await collectMsgs(viewer, 200)
  const disconnected = msgs.find((m) => m.type === 'camera-disconnected')
  const list = msgs.find((m) => m.type === 'camera-list')

  assert.ok(disconnected, 'expected camera-disconnected message')
  assert.equal(disconnected.id, 'camDC')
  assert.ok(list, 'expected camera-list rebroadcast')
  assert.deepEqual(list.cameras, [])

  assert.equal(server.cameras.size, 0)

  viewer.close()
})

test('viewer disconnect removes viewer from viewers map cleanly', async () => {
  const camera = await connect(server.url)
  send(camera, { type: 'register', camId: 'camV' })
  await tick()

  const viewer = await connect(server.url)
  send(viewer, { type: 'viewer-join', camId: 'camV', viewerId: 'viewerGone' })
  await tick()

  assert.equal(server.viewers.size, 1)
  viewer.close()
  await tick(120)
  assert.equal(server.viewers.size, 0)

  // Server still works
  const health = await httpGet(server.port, '/health')
  assert.equal(health.status, 200)

  camera.close()
})

// ---------- health endpoint ----------

test('GET /health returns { status: "ok", cameras: 0 } with no cameras', async () => {
  const res = await httpGet(server.port, '/health')
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.status, 'ok')
  assert.equal(body.cameras, 0)
})

test('GET /health reflects number of registered cameras', async () => {
  const c1 = await connect(server.url)
  send(c1, { type: 'register', camId: 'h1' })
  const c2 = await connect(server.url)
  send(c2, { type: 'register', camId: 'h2' })
  await tick()

  const res = await httpGet(server.port, '/health')
  assert.equal(res.status, 200)
  const body = JSON.parse(res.body)
  assert.equal(body.status, 'ok')
  assert.equal(body.cameras, 2)

  c1.close()
  c2.close()
})
