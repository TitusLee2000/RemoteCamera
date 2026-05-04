// alert-service.js — processes camera AI detection events into alerts.
//
// Flow:
//   1. detection-event arrives (camId here is the slot UUID — see signaling.js)
//   2. Load alert rule for the slot; skip if disabled or missing
//   3. Filter detections by object_classes + min_confidence
//   4. Enforce per-slot cooldown using alert_log
//   5. Insert an alert_log row, dispatch push + email best-effort

import { pool } from '../db/index.js'
import { sendPushToSlotSubscribers, isPushEnabled } from './push-service.js'
import { sendAlertEmail } from './email-service.js'

/**
 * Pick the highest-confidence detection that matches the rule.
 */
function pickTrigger(detections, rule) {
  if (!Array.isArray(detections) || detections.length === 0) return null
  const allowed = new Set(rule.object_classes ?? [])
  const minConf = Number(rule.min_confidence ?? 0)

  let best = null
  for (const d of detections) {
    if (!d || typeof d.class !== 'string') continue
    const score = Number(d.score)
    if (!Number.isFinite(score)) continue
    if (allowed.size > 0 && !allowed.has(d.class)) continue
    if (score < minConf) continue
    if (!best || score > best.score) best = { class: d.class, score }
  }
  return best
}

/**
 * Process a detection-event from a camera.
 * @param {string} camId  slot UUID (cameras map key)
 * @param {Array}  detections
 * @param {number} _timestamp  client-side timestamp (informational only)
 */
export async function processDetectionEvent(camId, detections, _timestamp) {
  if (!camId) return

  // Look up the slot. (camId IS the slot id in this codebase, but we
  // verify it exists and grab the slot name for the notification body.)
  let slot
  try {
    const { rows } = await pool.query(
      'SELECT id, name FROM camera_slots WHERE id = $1',
      [camId]
    )
    if (rows.length === 0) return
    slot = rows[0]
  } catch (err) {
    console.warn('[alerts] slot lookup failed:', err?.message)
    return
  }

  // Load rule.
  let rule
  try {
    const { rows } = await pool.query(
      'SELECT * FROM alert_rules WHERE slot_id = $1',
      [slot.id]
    )
    rule = rows[0]
  } catch (err) {
    console.warn('[alerts] rule lookup failed:', err?.message)
    return
  }
  if (!rule || !rule.enabled) return

  // Filter detections.
  const trigger = pickTrigger(detections, rule)
  if (!trigger) return

  // Cooldown.
  const cooldown = Math.max(0, Number(rule.cooldown_seconds) || 0)
  if (cooldown > 0) {
    try {
      const { rows } = await pool.query(
        `SELECT alerted_at FROM alert_log
         WHERE slot_id = $1
         ORDER BY alerted_at DESC
         LIMIT 1`,
        [slot.id]
      )
      if (rows.length > 0) {
        const last = new Date(rows[0].alerted_at).getTime()
        const ageSec = (Date.now() - last) / 1000
        if (ageSec < cooldown) return
      }
    } catch (err) {
      console.warn('[alerts] cooldown check failed:', err?.message)
    }
  }

  // Insert log row first so the row id can later be updated with delivery state.
  let logId
  try {
    const { rows } = await pool.query(
      `INSERT INTO alert_log (slot_id, detected_class, confidence)
       VALUES ($1, $2, $3) RETURNING id`,
      [slot.id, trigger.class, trigger.score]
    )
    logId = rows[0].id
  } catch (err) {
    console.warn('[alerts] alert_log insert failed:', err?.message)
    return
  }

  // Dispatch notifications best-effort.
  let pushSent = false
  let emailSent = false

  if (rule.push_enabled && isPushEnabled()) {
    try {
      const payload = {
        title: `Alert: ${trigger.class} detected`,
        body: `${slot.name} — ${Math.round(trigger.score * 100)}% confidence`,
        slotId: slot.id,
        slotName: slot.name,
        detectedClass: trigger.class,
        confidence: trigger.score,
        timestamp: Date.now(),
      }
      const ok = await sendPushToSlotSubscribers(slot.id, payload)
      pushSent = ok > 0
    } catch (err) {
      console.warn('[alerts] push dispatch failed:', err?.message)
    }
  }

  if (rule.email_enabled && rule.email_address) {
    try {
      emailSent = await sendAlertEmail(
        rule.email_address,
        slot.name,
        trigger.class,
        trigger.score
      )
    } catch (err) {
      console.warn('[alerts] email dispatch failed:', err?.message)
    }
  }

  // Persist delivery state.
  try {
    await pool.query(
      'UPDATE alert_log SET push_sent = $1, email_sent = $2 WHERE id = $3',
      [pushSent, emailSent, logId]
    )
  } catch (err) {
    console.warn('[alerts] alert_log update failed:', err?.message)
  }
}
