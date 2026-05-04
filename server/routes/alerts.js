// alerts.js — alert rules CRUD + alert log endpoints.

import { Router } from 'express'
import { pool } from '../db/index.js'
import { requireAuth } from '../auth/middleware.js'

const router = Router()

const DEFAULT_RULE = {
  enabled: false,
  object_classes: [],
  min_confidence: 0.7,
  cooldown_seconds: 60,
  email_enabled: false,
  email_address: null,
  push_enabled: true,
}

function mapRule(row, slotName) {
  return {
    slotId: row.slot_id,
    slotName: slotName ?? null,
    enabled: row.enabled,
    objectClasses: row.object_classes ?? [],
    minConfidence: Number(row.min_confidence),
    cooldownSeconds: Number(row.cooldown_seconds),
    emailEnabled: row.email_enabled,
    emailAddress: row.email_address,
    pushEnabled: row.push_enabled,
  }
}

function isPrivileged(req) {
  return req.user?.role === 'admin' || req.user?.role === 'operator'
}

/**
 * Resolve which slot ids the caller can see.
 *  - admin / operator → every slot
 *  - viewer          → their session slot only
 */
async function accessibleSlotIds(req) {
  if (isPrivileged(req)) {
    const { rows } = await pool.query('SELECT id FROM camera_slots')
    return rows.map((r) => r.id)
  }
  const slotId = req.session?.slotId
  return slotId ? [slotId] : []
}

router.use(requireAuth(['operator', 'viewer']))

/**
 * GET /api/alerts/rules
 * Returns alert rules for every accessible slot. If a slot has no rule
 * row yet, a default (disabled) rule is returned so the dashboard can
 * render a config form.
 */
router.get('/rules', async (req, res) => {
  try {
    const ids = await accessibleSlotIds(req)
    if (ids.length === 0) return res.json([])

    const { rows } = await pool.query(
      `SELECT s.id AS slot_id, s.name AS slot_name,
              r.enabled, r.object_classes, r.min_confidence, r.cooldown_seconds,
              r.email_enabled, r.email_address, r.push_enabled
       FROM camera_slots s
       LEFT JOIN alert_rules r ON r.slot_id = s.id
       WHERE s.id = ANY($1::uuid[])
       ORDER BY s.created_at ASC`,
      [ids]
    )

    res.json(rows.map((r) => ({
      slotId: r.slot_id,
      slotName: r.slot_name,
      enabled: r.enabled ?? DEFAULT_RULE.enabled,
      objectClasses: r.object_classes ?? DEFAULT_RULE.object_classes,
      minConfidence: r.min_confidence != null ? Number(r.min_confidence) : DEFAULT_RULE.min_confidence,
      cooldownSeconds: r.cooldown_seconds != null ? Number(r.cooldown_seconds) : DEFAULT_RULE.cooldown_seconds,
      emailEnabled: r.email_enabled ?? DEFAULT_RULE.email_enabled,
      emailAddress: r.email_address ?? DEFAULT_RULE.email_address,
      pushEnabled: r.push_enabled ?? DEFAULT_RULE.push_enabled,
    })))
  } catch (err) {
    console.error('[alerts] GET /rules failed:', err)
    res.status(500).json({ error: 'Failed to load rules' })
  }
})

/**
 * PUT /api/alerts/rules/:slotId
 * Upsert the alert rule for a slot. Operator-only.
 */
router.put('/rules/:slotId', async (req, res) => {
  if (!isPrivileged(req)) return res.status(403).json({ error: 'Forbidden' })

  const { slotId } = req.params
  const {
    enabled,
    objectClasses,
    minConfidence,
    cooldownSeconds,
    emailEnabled,
    emailAddress,
    pushEnabled,
  } = req.body ?? {}

  try {
    const { rows: slotRows } = await pool.query(
      'SELECT id FROM camera_slots WHERE id = $1',
      [slotId]
    )
    if (slotRows.length === 0) return res.status(404).json({ error: 'Slot not found' })

    const classes = Array.isArray(objectClasses)
      ? objectClasses.filter((c) => typeof c === 'string')
      : []
    const minConf = Math.max(0, Math.min(1, Number(minConfidence ?? DEFAULT_RULE.min_confidence)))
    const cooldown = Math.max(0, Math.floor(Number(cooldownSeconds ?? DEFAULT_RULE.cooldown_seconds)))

    const { rows } = await pool.query(
      `INSERT INTO alert_rules
         (slot_id, enabled, object_classes, min_confidence, cooldown_seconds,
          email_enabled, email_address, push_enabled, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (slot_id) DO UPDATE SET
         enabled          = EXCLUDED.enabled,
         object_classes   = EXCLUDED.object_classes,
         min_confidence   = EXCLUDED.min_confidence,
         cooldown_seconds = EXCLUDED.cooldown_seconds,
         email_enabled    = EXCLUDED.email_enabled,
         email_address    = EXCLUDED.email_address,
         push_enabled     = EXCLUDED.push_enabled,
         updated_at       = NOW()
       RETURNING *`,
      [
        slotId,
        Boolean(enabled),
        classes,
        minConf,
        cooldown,
        Boolean(emailEnabled),
        emailAddress ?? null,
        pushEnabled === undefined ? true : Boolean(pushEnabled),
      ]
    )

    res.json(mapRule(rows[0]))
  } catch (err) {
    console.error('[alerts] PUT /rules failed:', err)
    res.status(500).json({ error: 'Failed to save rule' })
  }
})

/**
 * GET /api/alerts/log
 * Returns the most recent 100 alert events visible to the caller.
 * Optional ?slotId=<uuid> filter.
 */
router.get('/log', async (req, res) => {
  try {
    const ids = await accessibleSlotIds(req)
    if (ids.length === 0) return res.json([])

    const filterId = req.query.slotId
    let visible = ids
    if (filterId) {
      if (!ids.includes(filterId)) return res.status(403).json({ error: 'Forbidden' })
      visible = [filterId]
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.slot_id, s.name AS slot_name,
              a.detected_class, a.confidence, a.alerted_at,
              a.push_sent, a.email_sent
       FROM alert_log a
       LEFT JOIN camera_slots s ON s.id = a.slot_id
       WHERE a.slot_id = ANY($1::uuid[])
       ORDER BY a.alerted_at DESC
       LIMIT 100`,
      [visible]
    )

    res.json(rows.map((r) => ({
      id: r.id,
      slotId: r.slot_id,
      slotName: r.slot_name,
      detectedClass: r.detected_class,
      confidence: Number(r.confidence),
      alertedAt: r.alerted_at,
      pushSent: r.push_sent,
      emailSent: r.email_sent,
    })))
  } catch (err) {
    console.error('[alerts] GET /log failed:', err)
    res.status(500).json({ error: 'Failed to load alert log' })
  }
})

export default router
