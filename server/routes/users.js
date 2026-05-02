import { Router } from 'express'
import bcrypt from 'bcrypt'
import { pool } from '../db/index.js'
import { requireAuth } from '../auth/middleware.js'

const router = Router()

// Admins see all users; operators see only viewers
router.get('/', requireAuth(['admin', 'operator']), async (req, res) => {
  const isAdmin = req.user.role === 'admin'
  const { rows } = await pool.query(
    isAdmin
      ? 'SELECT id, email, role, created_at FROM users ORDER BY created_at ASC'
      : "SELECT id, email, role, created_at FROM users WHERE role = 'viewer' ORDER BY created_at ASC"
  )
  res.json(rows)
})

// Admins can create any role; operators can only create viewers
router.post('/', requireAuth(['admin', 'operator']), async (req, res) => {
  const { email, password, role } = req.body
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'email, password, and role are required' })
  }
  const isAdmin = req.user.role === 'admin'
  const allowedRoles = isAdmin ? ['admin', 'operator', 'viewer'] : ['viewer']
  if (!allowedRoles.includes(role)) {
    return res.status(403).json({ error: isAdmin ? 'Invalid role' : 'Operators can only create viewer accounts' })
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

// Delete — admin only
router.delete('/:id', requireAuth('admin'), async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' })
  }
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [req.params.id])
  if (rowCount === 0) return res.status(404).json({ error: 'User not found' })
  res.json({ ok: true })
})

export default router
