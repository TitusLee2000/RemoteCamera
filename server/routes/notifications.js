// notifications.js — push subscription management.

import { Router } from 'express'
import { pool } from '../db/index.js'
import { requireAuth } from '../auth/middleware.js'
import { getVapidPublicKey } from '../services/push-service.js'

const router = Router()

/**
 * GET /api/notifications/vapid-public-key
 * Returns the server's VAPID public key for the browser to subscribe with.
 */
router.get('/vapid-public-key', requireAuth(), (_req, res) => {
  const publicKey = getVapidPublicKey()
  if (!publicKey) {
    return res.status(503).json({ error: 'Push not configured' })
  }
  res.json({ publicKey })
})

/**
 * POST /api/notifications/subscribe
 * Body: PushSubscription (browser-shape).
 * Upserts by endpoint so re-subscribes update keys.
 */
router.post('/subscribe', requireAuth(), async (req, res) => {
  const sub = req.body
  if (!sub || typeof sub !== 'object') {
    return res.status(400).json({ error: 'Invalid subscription' })
  }
  const endpoint = sub.endpoint
  const p256dh = sub.keys?.p256dh
  const auth = sub.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return res.status(400).json({ error: 'Subscription missing endpoint or keys' })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh  = EXCLUDED.p256dh,
         auth    = EXCLUDED.auth
       RETURNING id, created_at`,
      [req.user.id, endpoint, p256dh, auth]
    )
    res.status(201).json({ ok: true, id: rows[0].id })
  } catch (err) {
    console.error('[notifications] subscribe failed:', err)
    res.status(500).json({ error: 'Failed to save subscription' })
  }
})

/**
 * DELETE /api/notifications/unsubscribe
 * Removes all push subscriptions for the current user, or a specific
 * endpoint if provided in the body.
 */
router.delete('/unsubscribe', requireAuth(), async (req, res) => {
  try {
    const endpoint = req.body?.endpoint
    if (endpoint) {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2',
        [req.user.id, endpoint]
      )
    } else {
      await pool.query(
        'DELETE FROM push_subscriptions WHERE user_id = $1',
        [req.user.id]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('[notifications] unsubscribe failed:', err)
    res.status(500).json({ error: 'Failed to unsubscribe' })
  }
})

export default router
