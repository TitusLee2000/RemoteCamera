// recording-routes.js — REST endpoints for recording upload, listing, download, delete.
// Mount with: app.use('/api/recordings', recordingRouter)

import { Router } from 'express'
import multer from 'multer'
import { createReadStream, existsSync } from 'fs'
import { unlink } from 'fs/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { list, add, remove, getById } from './recordings-store.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RECORDINGS_DIR = join(__dirname, 'recordings')

// ── Multer storage: save to disk as {camId}_{startTime}.webm ──────────────────
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, RECORDINGS_DIR),
  filename: (req, _file, cb) => {
    const { camId, startTime } = req.body
    // sanitize: replace characters unsafe for filenames
    const safeCamId = (camId ?? 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
    const safeStart = (startTime ?? Date.now().toString()).replace(/[^a-zA-Z0-9_-]/g, '_')
    cb(null, `${safeCamId}_${safeStart}.webm`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB cap
  fileFilter: (_req, file, cb) => {
    // Accept any video/* or application/octet-stream (some browsers send that for .webm)
    cb(null, true)
  },
})

export const recordingRouter = Router()

// ── POST /api/recordings/upload ───────────────────────────────────────────────
recordingRouter.post('/upload', (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'File too large' })
      }
      return res.status(500).json({ error: err.message })
    }

    const { camId, startTime, duration } = req.body
    const file = req.file

    // Validate required fields
    if (!camId) return res.status(400).json({ error: 'Missing field: camId' })
    if (!startTime) return res.status(400).json({ error: 'Missing field: startTime' })
    if (!file) return res.status(400).json({ error: 'Missing field: video file' })

    const id = `${file.filename.replace(/\.webm$/, '')}`

    const entry = {
      id,
      camId,
      filename: file.filename,
      startTime,
      duration: Number(duration) || 0,
      fileSize: file.size,
      uploadedAt: new Date().toISOString(),
    }

    try {
      await add(entry)
    } catch (storeErr) {
      if (storeErr.code === 'ENOSPC') {
        return res.status(507).json({ error: 'Insufficient storage' })
      }
      return res.status(500).json({ error: storeErr.message })
    }

    return res.status(201).json({
      id,
      url: `/api/recordings/${encodeURIComponent(id)}/download`,
    })
  })
})

// ── GET /api/recordings ───────────────────────────────────────────────────────
recordingRouter.get('/', async (req, res) => {
  try {
    const { camId } = req.query
    const recordings = await list(camId || undefined)
    return res.json(recordings)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// ── GET /api/recordings/:id/download ─────────────────────────────────────────
recordingRouter.get('/:id/download', async (req, res) => {
  const { id } = req.params
  try {
    const entry = await getById(id)
    if (!entry) return res.status(404).json({ error: 'Recording not found' })

    const filePath = join(RECORDINGS_DIR, entry.filename)
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'Recording file missing from disk' })
    }

    res.setHeader('Content-Type', 'video/webm')
    res.setHeader('Content-Disposition', `inline; filename="${entry.filename}"`)

    const stream = createReadStream(filePath)
    stream.on('error', (streamErr) => {
      console.error('[recordings] stream error:', streamErr.message)
      if (!res.headersSent) res.status(500).json({ error: 'Stream failed' })
    })
    stream.pipe(res)
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})

// ── DELETE /api/recordings/:id ────────────────────────────────────────────────
recordingRouter.delete('/:id', async (req, res) => {
  const { id } = req.params
  try {
    const entry = await getById(id)
    if (!entry) return res.status(404).json({ error: 'Recording not found' })

    // Remove file from disk (best-effort — don't fail if already gone)
    const filePath = join(RECORDINGS_DIR, entry.filename)
    try {
      await unlink(filePath)
    } catch (unlinkErr) {
      if (unlinkErr.code !== 'ENOENT') {
        console.warn('[recordings] unlink failed:', unlinkErr.message)
      }
    }

    await remove(id)
    return res.json({ ok: true })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
})
