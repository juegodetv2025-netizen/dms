import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import nodemailer from 'nodemailer'
import { activate, requireDevice, licenseConfigured, LicenseError } from './license.js'

const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.use(express.json({ limit: '10mb' }))

const configured = !!(process.env.SMTP_USER && process.env.SMTP_PASS)
const transporter = configured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null

app.get('/api/status', (_req, res) => res.json({ emailConfigured: configured }))

// Freno simple contra fuerza bruta de códigos: 10 intentos / 15 min por IP.
const attempts = new Map()
function activateLimiter(req, res, next) {
  const now = Date.now()
  const hits = (attempts.get(req.ip) || []).filter((t) => now - t < 15 * 60_000)
  if (hits.length >= 10) return res.status(429).json({ ok: false, reason: 'rate', error: 'Demasiados intentos, espera unos minutos' })
  attempts.set(req.ip, [...hits, now])
  next()
}

app.post('/api/activate', activateLimiter, async (req, res) => {
  try {
    res.json({ ok: true, ...(await activate(req.body?.code, req.headers['user-agent'])) })
  } catch (e) {
    if (e instanceof LicenseError) return res.status(e.status).json({ ok: false, reason: e.reason, error: e.message })
    console.error(e)
    res.status(500).json({ ok: false, reason: 'error', error: 'Error al activar' })
  }
})

app.get('/api/license/check', requireDevice, (req, res) =>
  res.json({ ok: true, customer: req.customer.name, label: req.device.label, expiresAt: req.customer.expires_at })
)

app.post('/api/alert', requireDevice, async (req, res) => {
  const { to, type, label, driver, vehicle, image, time, location, metrics } = req.body || {}
  if (!to || !image) return res.status(400).json({ error: 'Faltan destinatario o imagen' })
  if (!transporter) return res.status(503).json({ error: 'SMTP no configurado (.env)' })

  const b64 = String(image).replace(/^data:image\/\w+;base64,/, '')
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px">
      <h2 style="color:#dc2626;margin:0 0 8px">⚠️ Alerta de conducción: ${label}</h2>
      <table style="font-size:14px;line-height:1.6">
        <tr><td><b>Conductor:</b></td><td>${driver || '-'}</td></tr>
        <tr><td><b>Vehículo:</b></td><td>${vehicle || '-'}</td></tr>
        <tr><td><b>Hora:</b></td><td>${time}</td></tr>
        <tr><td><b>Ubicación:</b></td><td>${location || 'No disponible'}</td></tr>
        <tr><td><b>Atención:</b></td><td>${metrics?.awareness ?? '-'}%</td></tr>
      </table>
      <p><img src="cid:evento" style="width:100%;border-radius:8px" /></p>
    </div>`
  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to,
      subject: `[DMS] ${label} - ${vehicle || 'Vehículo'}`,
      html,
      attachments: [{ filename: `evento-${type}.jpg`, content: b64, encoding: 'base64', cid: 'evento' }],
    })
    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.listen(process.env.PORT || 3001, () =>
  console.log(`Servidor de alertas en :${process.env.PORT || 3001} (SMTP ${configured ? 'OK' : 'NO configurado'}, licencias ${licenseConfigured ? 'OK' : 'NO configuradas'})`)
)
