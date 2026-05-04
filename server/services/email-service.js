// email-service.js — sends alert emails via SMTP (nodemailer).
// Gracefully no-ops when SMTP env vars are not configured.

import nodemailer from 'nodemailer'

let transporter = null
let configured = false

function init() {
  if (configured) return
  configured = true

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env
  if (!SMTP_HOST || !SMTP_PORT) {
    console.warn('[email] SMTP not configured (SMTP_HOST/SMTP_PORT missing) — emails disabled')
    return
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  })

  console.log(`[email] configured (host=${SMTP_HOST}, port=${SMTP_PORT})`)
}

/**
 * Send a "detection" alert email.
 * @param {string} toAddress
 * @param {string} slotName
 * @param {string} detectedClass
 * @param {number} confidence  0..1
 * @returns {Promise<boolean>} true if sent
 */
export async function sendAlertEmail(toAddress, slotName, detectedClass, confidence) {
  init()
  if (!transporter) {
    console.warn('[email] skip — transporter not configured')
    return false
  }
  if (!toAddress) {
    console.warn('[email] skip — no recipient address')
    return false
  }

  const from = process.env.SMTP_FROM ?? 'RemoteCamera <noreply@example.com>'
  const pct = Math.round(Number(confidence) * 100)
  const subject = `Alert: ${detectedClass} detected on ${slotName}`
  const text = `${detectedClass} detected on "${slotName}" with ${pct}% confidence at ${new Date().toISOString()}.`
  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, sans-serif; padding: 16px; max-width: 480px;">
      <h2 style="margin: 0 0 12px 0; color: #d32f2f;">RemoteCamera Alert</h2>
      <p style="margin: 0 0 8px 0;">A <b>${detectedClass}</b> was detected on camera <b>${slotName}</b>.</p>
      <p style="margin: 0 0 8px 0;">Confidence: <b>${pct}%</b></p>
      <p style="margin: 0; color: #666; font-size: 12px;">${new Date().toISOString()}</p>
    </div>
  `

  try {
    await transporter.sendMail({ from, to: toAddress, subject, text, html })
    return true
  } catch (err) {
    console.warn('[email] sendMail failed:', err?.message ?? err)
    return false
  }
}
