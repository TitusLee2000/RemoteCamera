import { Router } from 'express'
import { pool } from '../db/index.js'
import { requireAuth } from '../auth/middleware.js'
import { cameras } from '../signaling.js'

const router = Router()

// Public route — validates a camera code (must be before requireAuth)
export const slotsPublicRouter = Router()

slotsPublicRouter.post('/validate', async (req, res) => {
  const { code } = req.body
  if (!code) return res.status(400).json({ error: 'code is required' })
  const { rows } = await pool.query(
    'SELECT id, name FROM camera_slots WHERE code = $1', [code]
  )
  if (rows.length === 0) return res.status(404).json({ error: 'Invalid access code' })
  res.json({ ok: true, slotId: rows[0].id, slotName: rows[0].name })
})

// Protected routes (operator only)
router.use(requireAuth('operator'))

async function uniqueCode() {
  const { nanoid } = await import('nanoid')
  let code, exists = true
  while (exists) {
    code = nanoid(12)
    const { rows } = await pool.query('SELECT id FROM camera_slots WHERE code = $1', [code])
    exists = rows.length > 0
  }
  return code
}

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, name, code, created_at FROM camera_slots ORDER BY created_at ASC'
  )
  const liveSlotIds = new Set(
    [...cameras.values()].map((ws) => ws._slotId).filter(Boolean)
  )
  res.json(rows.map((s) => ({ ...s, live: liveSlotIds.has(s.id) })))
})

router.post('/', async (req, res) => {
  const { name } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })
  const code = await uniqueCode()
  const { rows } = await pool.query(
    'INSERT INTO camera_slots (name, code, created_by) VALUES ($1, $2, $3) RETURNING id, name, code, created_at',
    [name.trim(), code, req.user.id]
  )
  res.status(201).json(rows[0])
})

router.delete('/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM camera_slots WHERE id = $1', [req.params.id])
  if (rows.length === 0) return res.status(404).json({ error: 'Slot not found' })
  for (const [, ws] of cameras.entries()) {
    if (ws._slotId === req.params.id) {
      try { ws.terminate() } catch {}
    }
  }
  await pool.query('DELETE FROM camera_slots WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

router.post('/:id/regenerate', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM camera_slots WHERE id = $1', [req.params.id])
  if (rows.length === 0) return res.status(404).json({ error: 'Slot not found' })
  for (const [, ws] of cameras.entries()) {
    if (ws._slotId === req.params.id) {
      try { ws.terminate() } catch {}
    }
  }
  const code = await uniqueCode()
  const { rows: updated } = await pool.query(
    'UPDATE camera_slots SET code = $1 WHERE id = $2 RETURNING id, name, code, created_at',
    [code, req.params.id]
  )
  res.json(updated[0])
})

export default router
