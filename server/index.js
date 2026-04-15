// index.js — Express + WebSocket entry point for RemoteCamera signaling server.
// Exports createApp() so tests can spin up an instance on a random port.
// Only auto-listens when run directly (node index.js).

import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import {
  cameras,
  viewers,
  allClients,
  cameraLockStates,
  handleMessage,
  cleanup,
} from './signaling.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * Build an Express app + attached HTTP server + WebSocket server.
 * Does NOT call .listen() — caller decides when to bind.
 */
export function createApp() {
  const app = express()

  app.use(express.json())

  // Serve phone client and dashboard as static sites.
  // Phone:     http://<LAN-IP>:3001/client
  // Dashboard: http://<LAN-IP>:3001/dashboard
  app.use('/client', express.static(join(__dirname, '../client')))
  app.use('/dashboard', express.static(join(__dirname, '../dashboard')))

  // Health check — handy for LAN debugging and test harness readiness probes.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', cameras: cameras.size })
  })

  // ICE server credentials — fetched from Metered.ca if API key is set,
  // otherwise falls back to Google STUN only (works on LAN, not WAN).
  app.get('/api/ice-servers', async (_req, res) => {
    const apiKey = process.env.METERED_API_KEY
    const appName = process.env.METERED_APP_NAME
    if (apiKey && appName) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const url = `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`
        const r = await fetch(url, { signal: controller.signal })
        clearTimeout(timeout)
        if (r.ok) {
          const servers = await r.json()
          return res.json(servers)
        }
        console.warn('[ice] Metered fetch failed, status', r.status)
      } catch (err) {
        clearTimeout(timeout)
        console.warn('[ice] Metered fetch error:', err?.message)
      }
    }
    // Fallback: Open Relay free TURN (works on WAN without API key)
    res.json([
      { urls: 'stun:openrelay.metered.ca:80' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ])
  })

  const httpServer = createServer(app)
  const wss = new WebSocketServer({ server: httpServer })

  wss.on('connection', (ws) => {
    console.log('[server] websocket connected')
    allClients.add(ws)

    // Send current camera list immediately so dashboards populate on connect
    // without having to send viewer-join first. Phone client ignores this.
    try {
      ws.send(JSON.stringify({
        type: 'camera-list',
        cameras: Array.from(cameras.keys()).map((id) => ({
          id,
          locked: cameraLockStates.get(id) ?? false,
        })),
      }))
    } catch {}

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch (err) {
        console.warn('[server] ignoring malformed JSON:', err?.message)
        return
      }
      try {
        handleMessage(ws, msg)
      } catch (err) {
        console.error('[server] handler error:', err)
      }
    })

    ws.on('close', () => { allClients.delete(ws); cleanup(ws) })
    ws.on('error', (err) => {
      console.warn('[server] ws error:', err?.message)
      allClients.delete(ws)
      cleanup(ws)
    })
  })

  return { app, httpServer, wss, cameras, viewers }
}

// Only listen when this file is executed directly (not when imported by tests).
const isDirect = (() => {
  try {
    if (!process.argv[1]) return false
    return process.argv[1] === new URL(import.meta.url).pathname
  } catch {
    return false
  }
})()

// On Windows, URL pathname starts with `/C:/...` while argv[1] is `C:\...`.
// Fall back to a filename-basename comparison to cover that case.
const isDirectFallback = (() => {
  try {
    if (!process.argv[1]) return false
    const here = new URL(import.meta.url).pathname.replace(/^\/+/, '').replace(/\\/g, '/').toLowerCase()
    const invoked = process.argv[1].replace(/\\/g, '/').toLowerCase()
    return here === invoked || here.endsWith(invoked) || invoked.endsWith(here)
  } catch {
    return false
  }
})()

if (isDirect || isDirectFallback) {
  const PORT = Number(process.env.PORT ?? 3001)
  const { httpServer } = createApp()
  httpServer.listen(PORT, () => {
    console.log(`[server] RemoteCamera signaling listening on :${PORT}`)
    console.log(`[server] phone client:  http://localhost:${PORT}/client`)
    console.log(`[server] dashboard:     http://localhost:${PORT}/dashboard`)
    console.log(`[server] health:        http://localhost:${PORT}/health`)
  })
}
