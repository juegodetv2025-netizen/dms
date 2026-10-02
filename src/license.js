import { useCallback, useEffect, useState } from 'react'

const KEY = 'dms-license'
const GRACE_MS = 72 * 3600 * 1000 // sin red, la app sigue funcionando hasta 72 h tras la última verificación
const API = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null')
  } catch {
    return null
  }
}
const save = (v) => {
  try {
    v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY)
  } catch {}
}

export const getToken = () => load()?.token || ''
export const authHeaders = () => (getToken() ? { Authorization: `Bearer ${getToken()}` } : {})

async function activate(code) {
  const r = await fetch(`${API}/api/activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`)
  save({ token: j.token, customer: j.customer, label: j.label, lastOk: Date.now() })
  return load()
}

/** 'ok' | 'grace' (sin red pero dentro del margen) | 'invalid' (revocada/vencida/suspendida o margen agotado) */
async function verify() {
  const lic = load()
  if (!lic?.token) return { state: 'invalid', reason: 'no_token' }
  try {
    const r = await fetch(`${API}/api/license/check`, { headers: { Authorization: `Bearer ${lic.token}` } })
    if (r.ok) {
      save({ ...lic, lastOk: Date.now() })
      return { state: 'ok' }
    }
    if (r.status === 401 || r.status === 403) {
      const j = await r.json().catch(() => ({}))
      save(null)
      return { state: 'invalid', reason: j.reason, error: j.error }
    }
    throw new Error(`HTTP ${r.status}`) // 5xx del servidor: tratar como falta de red
  } catch {
    return Date.now() - (lic.lastOk || 0) < GRACE_MS ? { state: 'grace' } : { state: 'invalid', reason: 'offline_expired' }
  }
}

export function useLicense() {
  const [state, setState] = useState(() => (load()?.token ? 'checking' : 'invalid'))
  const [info, setInfo] = useState(null)

  const run = useCallback(async () => {
    const v = await verify()
    setState(v.state)
    setInfo(v.state === 'invalid' ? v : null)
  }, [])

  useEffect(() => {
    if (!load()?.token) return
    run()
    const id = setInterval(run, 30 * 60 * 1000)
    window.addEventListener('online', run)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', run)
    }
  }, [run])

  const doActivate = async (code) => {
    await activate(code)
    setInfo(null)
    setState('ok')
  }
  // 'checking' deja pasar a la app (la verificación va en segundo plano) para no bloquear sin red.
  return { allowed: state !== 'invalid', info, activate: doActivate }
}
