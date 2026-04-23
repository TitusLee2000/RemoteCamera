import { Router } from 'express'
import bcrypt from 'bcrypt'
import passport from '../auth/passport.js'
import { pool } from '../db/index.js'
import { requireAuth } from '../auth/middleware.js'

const router = Router()

router.get('/first-run', async (_req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*) FROM users')
  res.json({ firstRun: rows[0].count === '0' })
})

router.post('/setup', async (req, res) => {
  const { rows } = await pool.query('SELECT COUNT(*) FROM users')
  if (rows[0].count !== '0') {
    return res.status(403).json({ error: 'Setup already complete' })
  }
  const { email, password } = req.body
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and password (min 8 chars) required' })
  }
  const hash = await bcrypt.hash(password, 12)
  const { rows: newRows } = await pool.query(
    'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING *',
    [email.toLowerCase().trim(), hash, 'admin']
  )
  req.login(newRows[0], (err) => {
    if (err) return res.status(500).json({ error: 'Login after setup failed' })
    res.status(201).json({ ok: true })
  })
})

router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err)
    if (!user) return res.status(401).json({ error: info?.message ?? 'Invalid credentials' })
    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr)
      res.json({ ok: true, role: user.role })
    })
  })(req, res, next)
})

router.post('/logout', requireAuth(), (req, res) => {
  req.logout(() => res.json({ ok: true }))
})

router.get('/me', requireAuth(), (req, res) => {
  const { id, email, role, created_at } = req.user
  res.json({ id, email, role, created_at })
})

export default router
