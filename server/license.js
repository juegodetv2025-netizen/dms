import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env

export const licenseConfigured = !!(SUPABASE_URL && SUPABASE_SERVICE_KEY)
export const db = licenseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  : null

// Sin 0/O/1/I para que el código se pueda dictar sin errores.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const newToken = () => `dms_${crypto.randomBytes(32).toString('base64url')}`

export function newCode() {
  let c = ''
  for (let i = 0; i < 8; i++) c += ALPHABET[crypto.randomInt(ALPHABET.length)]
  return `${c.slice(0, 4)}-${c.slice(4)}`
}

class LicenseError extends Error {
  constructor(status, reason, message) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

function customerProblem(c) {
  if (c.status === 'suspended') return new LicenseError(403, 'suspended', 'Licencia suspendida. Contacta a tu proveedor.')
  if (c.status === 'expired' || new Date(c.expires_at) < new Date())
    return new LicenseError(403, 'expired', 'Licencia vencida. Contacta a tu proveedor.')
  return null
}

/** Canjea un código de activación por un token de dispositivo. */
export async function activate(rawCode, userAgent) {
  if (!db) throw new LicenseError(503, 'unconfigured', 'Licencias no configuradas en el servidor')
  const norm = normCode(rawCode)
  if (norm.length !== 8) throw new LicenseError(400, 'bad_code', 'Código inválido')

  const { data: code } = await db
    .from('activation_codes')
    .select('id, customer_id, label, expires_at, used_at, customers(*)')
    .eq('code_hash', sha256(norm))
    .maybeSingle()
  if (!code || code.used_at || new Date(code.expires_at) < new Date())
    throw new LicenseError(400, 'bad_code', 'Código inválido, usado o vencido')

  const bad = customerProblem(code.customers)
  if (bad) throw bad

  const { count } = await db
    .from('devices')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', code.customer_id)
    .eq('status', 'active')
  if (count >= code.customers.max_devices)
    throw new LicenseError(403, 'limit', `Límite de vehículos alcanzado (${code.customers.max_devices})`)

  // Reclamo atómico: si dos personas canjean a la vez, solo una obtiene la fila.
  const { data: claimed } = await db
    .from('activation_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', code.id)
    .is('used_at', null)
    .select('id')
  if (!claimed?.length) throw new LicenseError(400, 'bad_code', 'Código inválido, usado o vencido')

  const token = newToken()
  const { error } = await db.from('devices').insert({
    customer_id: code.customer_id,
    label: code.label,
    token_hash: sha256(token),
    last_seen: new Date().toISOString(),
  })
  if (error) throw new LicenseError(500, 'db', 'No se pudo registrar el dispositivo')
  return { token, customer: code.customers.name, label: code.label, expiresAt: code.customers.expires_at }
}

/** Valida un token de dispositivo y la licencia del cliente. */
export async function checkToken(token) {
  if (!db) throw new LicenseError(503, 'unconfigured', 'Licencias no configuradas en el servidor')
  if (!token) throw new LicenseError(401, 'no_token', 'Falta token')
  const { data: dev } = await db
    .from('devices')
    .select('id, label, status, last_seen, customer_id, customers(*)')
    .eq('token_hash', sha256(token))
    .maybeSingle()
  if (!dev || dev.status !== 'active') throw new LicenseError(401, 'revoked', 'Dispositivo no autorizado')
  const bad = customerProblem(dev.customers)
  if (bad) throw bad

  if (!dev.last_seen || Date.now() - new Date(dev.last_seen) > 60_000)
    db.from('devices').update({ last_seen: new Date().toISOString() }).eq('id', dev.id).then(() => {})
  return { device: dev, customer: dev.customers }
}

export async function requireDevice(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  try {
    const { device, customer } = await checkToken(token)
    req.device = device
    req.customer = customer
    next()
  } catch (e) {
    if (!(e instanceof LicenseError)) {
      console.error(e)
      return res.status(500).json({ ok: false, reason: 'error', error: 'Error de licencia' })
    }
    res.status(e.status).json({ ok: false, reason: e.reason, error: e.message })
  }
}

export { LicenseError }
