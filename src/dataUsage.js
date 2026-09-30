import { useEffect, useRef, useState } from 'react'
import { notify } from './notify.js'

// Contador mensual de datos móviles del vehículo (video en vivo + alertas), guardado en el equipo.
// Mide lo enviado y recibido por WebRTC y lo enviado a Telegram. No incluye la descarga inicial de la app.
const KEY = 'dms-data'
const monthKey = () => new Date().toISOString().slice(0, 7)
const empty = () => ({ month: monthKey(), live: 0, alerts: 0, flags: { warn: false, limit: false } })

function load() {
  try {
    const j = JSON.parse(localStorage.getItem(KEY))
    if (j && j.month === monthKey()) return { ...empty(), ...j, flags: { ...empty().flags, ...j.flags } }
  } catch {}
  return empty()
}

let state = load()
let savedAt = 0
const listeners = new Set()
const persist = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {}
}
const emit = () => listeners.forEach((f) => f(state))
const roll = () => {
  if (state.month !== monthKey()) state = empty() // nuevo mes: reinicia solo
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', persist)

export function addData(kind, bytes) {
  if (!(bytes > 0)) return
  roll()
  state = { ...state, [kind]: state[kind] + bytes }
  if (Date.now() - savedAt > 2000) {
    savedAt = Date.now()
    persist()
  }
  emit()
}
export function resetData() {
  state = empty()
  persist()
  emit()
}
const setFlags = (flags) => {
  state = { ...state, flags: { ...state.flags, ...flags } }
  persist()
  emit()
}

// metaRef.current() -> { vehicle, driver, awareness }
export function useDataUsage(s, metaRef) {
  const [d, setD] = useState(() => (roll(), state))
  useEffect(() => {
    listeners.add(setD)
    return () => listeners.delete(setD)
  }, [])
  const used = d.live + d.alerts
  const limit = (Number(s.dataLimitGB) || 0) * 1024 ** 3
  const pct = limit ? (used / limit) * 100 : 0
  const warnPct = Number(s.dataWarnPct) || 80
  const level = !limit ? 'ok' : pct >= 100 ? 'limit' : pct >= warnPct ? 'warn' : 'ok'
  const sRef = useRef(s)
  sRef.current = s

  useEffect(() => {
    const f = d.flags
    if (level === 'ok') {
      if (f.warn || f.limit) setFlags({ warn: false, limit: false }) // si subes el límite, vuelve a avisar
      return
    }
    if (level === 'warn' && f.limit) return void setFlags({ limit: false })
    const already = level === 'limit' ? f.limit : f.warn
    if (already) return
    const m = metaRef.current?.() || {}
    const gb = (x) => (x / 1024 ** 3).toFixed(2)
    const text =
      level === 'limit'
        ? `🚨 LÍMITE DE DATOS SUPERADO\n🚚 ${m.vehicle || '-'} · 👤 ${m.driver || '-'}\nConsumo: ${gb(used)} GB de ${s.dataLimitGB} GB este mes`
        : `⚠️ Consumo de datos al ${Math.round(pct)}%\n🚚 ${m.vehicle || '-'} · 👤 ${m.driver || '-'}\nConsumo: ${gb(used)} GB de ${s.dataLimitGB} GB este mes`
    setFlags(level === 'limit' ? { warn: true, limit: true } : { warn: true })
    notify(sRef.current, {
      type: 'data',
      label: level === 'limit' ? 'Límite de datos superado' : 'Consumo de datos alto',
      text,
      vehicle: m.vehicle,
      driver: m.driver,
      time: new Date().toLocaleString(),
      awareness: Math.round(m.awareness ?? 0),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, d.flags.warn, d.flags.limit])

  return { used, live: d.live, alerts: d.alerts, limit, pct, level, reset: resetData }
}
