import 'dotenv/config'
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'
import session from 'express-session'
import connectPgSimple from 'connect-pg-simple'
import passportInstance from './auth/passport.js'
import { requireAuthRedirect } from './auth/middleware.js'
import { runMigrations } from './db/migrate.js'
import { pool } from './db/index.js'
import authRouter from './routes/auth.js'
import usersRouter from './routes/users.js'
import slotsRouter from './routes/slots.js'
import { slotsPublicRouter } from './routes/slots.js'
import {
  cameras, viewers, allClients, cameraLockStates, handleMessage, cleanup,
} from './signaling.js'
import { recordingRouter } from './recording-routes.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PgSession = connectPgSimple(session)

export async function createApp() {
  await runMigrations()

  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())

  // Session middleware
  const sessionMiddleware = session({
    store: new PgSession({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })

  app.use(sessionMiddleware)
  app.use(passportInstance.initialize())
  app.use(passportInstance.session())

  // Public auth routes
  app.use('/api/auth', authRouter)

  // Public slot validate (before protected routes)
  app.use('/api/slots', slotsPublicRouter)

  // Protected API routes
  app.use('/api/users', usersRouter)
  app.use('/api/slots', slotsRouter)
  app.use('/api/recordings', recordingRouter)

  // Login page (public)
  app.use('/login', express.static(join(__dirname, '../login')))

  // Protected page routes
  app.use('/', requireAuthRedirect(['operator', 'viewer']), express.static(join(__dirname, '../dashboard')))
  app.use('/client', express.static(join(__dirname, '../client')))

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok', cameras: cameras.size }))

  // ICE servers
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
        if (r.ok) return res.json(await r.json())
        console.warn('[ice] Metered fetch failed, status', r.status)
      } catch (err) {
        clearTimeout(timeout)
        console.warn('[ice] Metered fetch error:', err?.message)
      }
    }
    res.json([
      { urls: 'stun:openrelay.metered.ca:80' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ])
  })

  const httpServer = createServer(app)
  const wss = new WebSocketServer({ server: httpServer, handleProtocols: () => false })

  // WebSocket auth: parse session cookie before upgrading
  httpServer.on('upgrade', (req, socket, head) => {
    const mockRes = { getHeader: () => {}, setHeader: () => {}, end: () => {} }
    sessionMiddleware(req, mockRes, () => {
      passportInstance.initialize()(req, mockRes, () => {
        passportInstance.session()(req, mockRes, () => {
          wss.handleUpgrade(req, socket, head, (ws) => {
            ws._user = req.user ?? null
            ws._isAuthenticated = req.isAuthenticated?.() ?? false
            wss.emit('connection', ws, req)
          })
        })
      })
    })
  })

  // Ping all clients every 25s to keep connections alive on Render free tier
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate()
      ws.isAlive = false
      ws.ping()
    })
  }, 25000)
  wss.on('close', () => clearInterval(heartbeat))

  wss.on('connection', (ws) => {
    console.log('[server] websocket connected')
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    allClients.add(ws)

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
      try { msg = JSON.parse(raw.toString()) }
      catch (err) { console.warn('[server] ignoring malformed JSON:', err?.message); return }
      try { handleMessage(ws, msg) }
      catch (err) { console.error('[server] handler error:', err) }
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

const isDirect = (() => {
  try {
    if (!process.argv[1]) return false
    return process.argv[1] === new URL(import.meta.url).pathname
  } catch { return false }
})()

const isDirectFallback = (() => {
  try {
    if (!process.argv[1]) return false
    const here = new URL(import.meta.url).pathname.replace(/^\/+/, '').replace(/\\/g, '/').toLowerCase()
    const invoked = process.argv[1].replace(/\\/g, '/').toLowerCase()
    return here === invoked || here.endsWith(invoked) || invoked.endsWith(here)
  } catch { return false }
})()

if (isDirect || isDirectFallback) {
  const PORT = Number(process.env.PORT ?? 3001)
  createApp().then(({ httpServer }) => {
    httpServer.listen(PORT, () => {
      console.log(`[server] RemoteCamera listening on :${PORT}`)
    })
  })
}
