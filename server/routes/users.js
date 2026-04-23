import { Router } from 'express'
import bcrypt from 'bcrypt'
import { pool } from '../db/index.js'
import { requireAuth } from '../auth/middleware.js'

const router = Router()
router.use(requireAuth('admin'))

router.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, role, created_at FROM users ORDER BY created_at ASC'
  )
  res.json(rows)
})

router.post('/', async (req, res) => {
  const { email, password, role } = req.body
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, and role are required' })
  }
  if (!['admin', 'operator', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, operator, or viewer' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' })
  }
  const hash = await bcrypt.hash(password, 12)
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at',
      [email.toLowerCase().trim(), hash, role]
    )
    res.status(201).json(rows[0])
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' })
    throw err
  }
})

router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' })
  }
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id])
  if (rowCount === 0) return res.status(404).json({ error: 'User not found' })
  res.json({ ok: true })
})

export default router
