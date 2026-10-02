// Notificaciones a coordinadores: Telegram (foto + texto) y/o webhook propio (correo).
// Si no hay conexión, las alertas quedan en cola (localStorage) y se reenvían solas.

import { addData } from './dataUsage.js'
import { authHeaders } from './license.js'

const QKEY = 'dms-queue'

const loadQ = () => {
  try {
    return JSON.parse(localStorage.getItem(QKEY) || '[]')
  } catch {
    return []
  }
}
const saveQ = (q) => {
  try {
    localStorage.setItem(QKEY, JSON.stringify(q))
  } catch {
    // almacenamiento lleno: se descarta la más antigua y se reintenta
    try {
      localStorage.setItem(QKEY, JSON.stringify(q.slice(-5)))
    } catch {}
  }
}

export const queueSize = () => loadQ().length
export const telegramReady = (s) => !!(s.telegramToken && s.telegramChatId)
export const notifyReady = (s) => telegramReady(s) || !!s.webhookUrl

const dataUrlToBlob = (url) => {
  const [head, b64] = url.split(',')
  const mime = head.match(/:(.*?);/)[1]
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

const caption = (a) =>
  [
    `⚠️ ALERTA: ${a.label}`,
    `🚚 Vehículo: ${a.vehicle || '-'}`,
    `👤 Conductor: ${a.driver || '-'}`,
    `🕒 ${a.time}`,
    `📊 Atención: ${a.awareness}%`,
    a.location ? `📍 ${a.location}` : '📍 Ubicación no disponible',
  ].join('\n')

async function sendTelegram(s, a) {
  const base = `https://api.telegram.org/bot${s.telegramToken}`
  if (!a.image) {
    // Aviso solo de texto (p. ej. límite de datos)
    const text = a.text || caption(a)
    const r = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: s.telegramChatId, text }),
    })
    if (!r.ok) throw new Error(`Telegram ${r.status}`)
    addData('alerts', text.length + 800)
    return
  }
  const photo = dataUrlToBlob(a.image)
  const fd = new FormData()
  fd.append('chat_id', s.telegramChatId)
  fd.append('caption', caption(a))
  fd.append('photo', photo, 'evento.jpg')
  const r = await fetch(`${base}/sendPhoto`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error(`Telegram ${r.status}`)
  addData('alerts', photo.size + 1500)
}

async function sendWebhook(s, a) {
  const r = await fetch(s.webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ ...a, to: s.to }),
  })
  if (!r.ok) throw new Error(`Webhook ${r.status}`)
}

async function deliver(s, a) {
  const jobs = []
  if (telegramReady(s)) jobs.push(sendTelegram(s, a))
  if (s.webhookUrl) jobs.push(sendWebhook(s, a))
  if (!jobs.length) throw new Error('Sin canal configurado')
  await Promise.all(jobs)
}

/** Envía o encola. Devuelve 'sent' | 'queued' | 'off'. */
export async function notify(s, alert) {
  if (!notifyReady(s)) return 'off'
  try {
    if (!navigator.onLine) throw new Error('offline')
    await deliver(s, alert)
    return 'sent'
  } catch (e) {
    console.warn('Notificación en cola:', e.message)
    saveQ([...loadQ(), alert].slice(-20))
    return 'queued'
  }
}

/** Reintenta la cola. Devuelve cuántas quedan. */
export async function flushQueue(s) {
  if (!notifyReady(s) || !navigator.onLine) return queueSize()
  const q = loadQ()
  const rest = []
  for (const a of q) {
    try {
      await deliver(s, a)
    } catch {
      rest.push(a)
    }
  }
  saveQ(rest)
  return rest.length
}
