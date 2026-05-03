import { Router } from 'express'
import multer from 'multer'
import { pool } from './db/index.js'
import { requireAuth } from './auth/middleware.js'
import { uploadToStorage, deleteFromStorage, getSignedDownloadUrl } from './storage.js'

function mapRow(r) {
  return {
    id: r.id,
    camId: r.slot_id,
    storageKey: r.storage_key,
    startTime: r.start_time,
    duration: r.duration_ms,
    fileSize: r.file_size,
    uploadedAt: r.uploaded_at,
  }
}

const upload = multer({ storage: multer.memoryStorage() })

export const recordingRouter = Router()

// Upload — accepts slotId in form body
recordingRouter.post('/upload', upload.single('video'), async (req, res) => {
  const { slotId, startTime, duration } = req.body
  if (!slotId || !startTime || !req.file) {
    return res.status(400).json({ error: 'slotId, startTime, and video file required' })
  }
  const { rows } = await pool.query('SELECT id FROM camera_slots WHERE id = $1', [slotId])
  if (rows.length === 0) return res.status(404).json({ error: 'Slot not found' })

  const id = `${slotId}_${Date.now()}`
  const storageKey = `recordings/${id}.webm`

  try {
    await uploadToStorage(storageKey, req.file.buffer, req.file.mimetype || 'video/webm')
  } catch (err) {
    console.error('[recordings] Supabase upload failed:', err?.message ?? err)
    return res.status(502).json({ error: 'Storage upload failed', detail: err?.message })
  }

  try {
    await pool.query(
      'INSERT INTO recordings (id, slot_id, storage_key, start_time, duration_ms, file_size) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, slotId, storageKey, new Date(startTime), Number(duration) || 0, req.file.size]
    )
  } catch (err) {
    console.error('[recordings] DB insert failed:', err?.message ?? err)
    return res.status(500).json({ error: 'Database insert failed', detail: err?.message })
  }

  res.status(201).json({ id, url: `/api/recordings/${id}/download` })
})

// List — operators see all; viewers see own slot only
recordingRouter.get('/', requireAuth(['operator', 'viewer']), async (req, res) => {
  const camId = req.query.camId
  let query, params
  if (req.user?.role === 'operator' || req.user?.role === 'admin') {
    query = camId
      ? 'SELECT * FROM recordings WHERE slot_id = $1 ORDER BY uploaded_at DESC'
      : 'SELECT * FROM recordings ORDER BY uploaded_at DESC'
    params = camId ? [camId] : []
  } else {
    const slotId = req.session?.slotId
    if (!slotId) return res.json([])
    query = 'SELECT * FROM recordings WHERE slot_id = $1 ORDER BY uploaded_at DESC'
    params = [slotId]
  }
  const { rows } = await pool.query(query, params)
  res.json(rows.map(mapRow))
})

// Download — operators + viewers (own slot); redirects to R2 signed URL
recordingRouter.get('/:id/download', requireAuth(['operator', 'viewer']), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM recordings WHERE id = $1', [req.params.id])
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' })
  const rec = rows[0]

  if (req.user?.role !== 'operator' && req.user?.role !== 'admin') {
    const slotId = req.session?.slotId
    if (rec.slot_id !== slotId) return res.status(403).json({ error: 'Forbidden' })
  }

  const signedUrl = await getSignedDownloadUrl(rec.storage_key)
  res.redirect(signedUrl)
})

// Delete — operators only
recordingRouter.delete('/:id', requireAuth('operator'), async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM recordings WHERE id = $1', [req.params.id])
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' })
  try { await deleteFromStorage(rows[0].storage_key) } catch {}
  await pool.query('DELETE FROM recordings WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})
