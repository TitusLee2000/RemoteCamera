// push-service.js — Web Push (VAPID) helpers.
// Gracefully no-ops when VAPID keys are not configured.

import webpush from 'web-push'
import { pool } from '../db/index.js'

let configured = false
let enabled = false

function init() {
  if (configured) return
  configured = true

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[push] VAPID keys not configured — push disabled')
    return
  }

  webpush.setVapidDetails(
    VAPID_SUBJECT ?? 'mailto:admin@example.com',
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  )
  enabled = true
  console.log('[push] configured')
}

export function getVapidPublicKey() {
  init()
  return process.env.VAPID_PUBLIC_KEY ?? null
}

export function isPushEnabled() {
  init()
  return enabled
}

/**
 * Send a push to a single subscription row (DB row shape).
 * Returns true on 2xx, false otherwise. Deletes subscription on 404/410.
 */
export async function sendPush(subscription, payload) {
  init()
  if (!enabled) return false

  const sub = {
    endpoint: subscription.endpoint,
    keys: { p256dh: subscription.p256dh, auth: subscription.auth },
  }

  try {
    await webpush.sendNotification(sub, JSON.stringify(payload))
    return true
  } catch (err) {
    const status = err?.statusCode
    if (status === 404 || status === 410) {
      // Subscription is gone — clean up.
      try {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [subscription.endpoint])
        console.log('[push] removed stale subscription:', subscription.endpoint)
      } catch (delErr) {
        console.warn('[push] failed to delete stale subscription:', delErr?.message)
      }
    } else {
      console.warn('[push] sendNotification failed:', status ?? '', err?.message ?? err)
    }
    return false
  }
}

/**
 * Send a push to every subscriber that has access to a given slot.
 *
 * Access model (matches existing code):
 *   - admin and operator users have access to ALL slots
 *   - viewers tie to a single slot via session.slotId, NOT user table —
 *     therefore "viewer push" is not deliverable through the existing
 *     schema. We notify all admins + operators.
 *
 * @param {string} slotId
 * @param {object} payload  arbitrary JSON-serializable push payload
 * @returns {Promise<number>} count of successful sends
 */
export async function sendPushToSlotSubscribers(slotId, payload) {
  init()
  if (!enabled) return 0

  const { rows } = await pool.query(
    `SELECT ps.endpoint, ps.p256dh, ps.auth
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     WHERE u.role IN ('admin', 'operator')`
  )

  if (rows.length === 0) return 0

  let ok = 0
  await Promise.all(
    rows.map(async (sub) => {
      const sent = await sendPush(sub, payload)
      if (sent) ok += 1
    })
  )
  return ok
}
