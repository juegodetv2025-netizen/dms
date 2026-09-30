import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useDMS, ALERTS } from './useDMS.js'
import { notifyReady, telegramReady } from './notify.js'
import { useLiveBroadcast } from './useLiveBroadcast.js'
import { useDataUsage } from './dataUsage.js'
import { fmtBytes } from './format.js'

const DEFAULTS = {
  to: '',
  telegramToken: '',
  telegramChatId: '',
  webhookUrl: '',
  liveEnabled: false,
  fleet: '',
  vehicleId: '',
  pin: '',
  ice: '',
  perf: 'balanceado',
  dataLimitGB: 0,
  dataWarnPct: 80,
  driver: 'Conductor 1',
  vehicle: 'Vehículo 01',
  sound: true,
  drowsySec: 1.5,
  distractionSec: 2.5,
  yawDeg: 25,
  cooldownSec: 30,
}

function useSettings() {
  const [s, setS] = useState(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('dms-settings') || '{}') }
    } catch {
      return DEFAULTS
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('dms-settings', JSON.stringify(s))
    } catch {}
  }, [s])
  return [s, (k, v) => setS((p) => ({ ...p, [k]: v }))]
}

const scoreColor = (v) => (v > 70 ? '#22c55e' : v > 40 ? '#f59e0b' : '#ef4444')

function Gauge({ value }) {
  const R = 84
  const C = 2 * Math.PI * R
  const color = scoreColor(value)
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 200">
        <circle cx="100" cy="100" r={R} className="g-bg" />
        <motion.circle
          cx="100"
          cy="100"
          r={R}
          className="g-fg"
          strokeDasharray={C}
          animate={{ strokeDashoffset: C * (1 - value / 100), stroke: color }}
          transition={{ type: 'spring', stiffness: 60, damping: 18 }}
          style={{ filter: `drop-shadow(0 0 8px ${color})` }}
        />
      </svg>
      <div className="g-txt">
        <b style={{ color }}>{Math.round(value)}</b>
        <span>ATENCIÓN %</span>
      </div>
    </div>
  )
}

function Spark({ data }) {
  const w = 300
  const h = 70
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / 100) * h}`)
  const last = data[data.length - 1]
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="spark" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sg" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={scoreColor(last)} stopOpacity=".45" />
          <stop offset="1" stopColor={scoreColor(last)} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill="url(#sg)" />
      <polyline points={pts.join(' ')} fill="none" stroke={scoreColor(last)} strokeWidth="2.5" />
    </svg>
  )
}

function Stat({ label, value, unit, bad }) {
  return (
    <motion.div
      className={`stat ${bad ? 'bad' : ''}`}
      animate={{ scale: bad ? [1, 1.04, 1] : 1 }}
      transition={{ repeat: bad ? Infinity : 0, duration: 0.8 }}
    >
      <span>{label}</span>
      <b>
        {value}
        <small>{unit}</small>
      </b>
    </motion.div>
  )
}

function Chip({ on, label, color }) {
  return (
    <motion.span
      className="chip"
      animate={{ background: on ? color : 'rgba(255,255,255,.06)', color: on ? '#fff' : '#94a3b8', scale: on ? 1.06 : 1 }}
    >
      <i style={{ background: on ? '#fff' : color }} />
      {label}
    </motion.span>
  )
}

const mailTxt = { sending: 'Enviando…', sent: 'Notificado ✓', queued: 'En cola (sin conexión) ⏳', error: 'Error al notificar ✗', off: 'Sin canal configurado' }

export default function App() {
  const [s, set] = useSettings()
  const [showCfg, setShowCfg] = useState(false)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const dms = useDMS({ videoRef, canvasRef, settings: s })
  const { status, error, metrics: m, flags, active, history, events, queued, online } = dms
  const ready = notifyReady(s)
  const metaRef = useRef(() => ({}))
  metaRef.current = () => ({ vehicle: s.vehicle, driver: s.driver, awareness: m.awareness })
  const usage = useDataUsage(s, metaRef)

  // Telemetría que ve el coordinador (se lee cada segundo)
  const telRef = useRef(() => ({}))
  telRef.current = () => {
    const p = dms.getPos()
    return {
      driver: s.driver,
      vehicle: s.vehicle,
      awareness: Math.round(m.awareness),
      active,
      flags,
      pos: p ? { lat: p.latitude, lon: p.longitude, speed: p.speed } : null,
      data: { used: usage.used, limit: usage.limit, level: usage.level },
    }
  }
  const { viewers, liveState } = useLiveBroadcast({ settings: s, running: status === 'running', streamRef: dms.streamRef, telRef })
  const running = status === 'running'

  // ?autostart=1 -> inicia solo al abrir (modo kiosco del vehículo)
  useEffect(() => {
    if (new URLSearchParams(location.search).get('autostart') === '1') dms.start()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const top = active[0]

  return (
    <div className="app">
      <header>
        <div className="brand">
          <motion.span
            className="dot"
            animate={{ opacity: running ? [1, 0.3, 1] : 0.3 }}
            transition={{ repeat: Infinity, duration: 1.4 }}
            style={{ background: running ? '#22c55e' : '#64748b', color: running ? '#22c55e' : '#64748b' }}
          />
          <h1>
            DMS <small>Monitor de conductor</small>
          </h1>
        </div>
        <div className="head-r">
          <span className="pill">
            {running ? `EN LÍNEA · ${m.fps} fps` : status === 'loading' ? 'Cargando modelos…' : 'Detenido'}
          </span>
          {viewers > 0 && (
            <motion.span className="pill live" animate={{ opacity: [1, 0.5, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>
              🔴 EN VIVO · coordinación viendo la cabina
            </motion.span>
          )}
          {s.liveEnabled && viewers === 0 && (
            <span className={`pill ${liveState === 'ready' ? 'ok' : 'no'}`}>
              {liveState === 'ready' ? 'Transmisión disponible' : liveState === 'error' ? 'Transmisión: reconectando' : 'Transmisión: conectando'}
            </span>
          )}
          <span className={`pill ${online ? 'ok' : 'no'}`}>{online ? 'Con conexión' : 'Sin conexión'}</span>
          <span className={`pill ${ready ? 'ok' : 'no'}`}>
            {ready ? `Alertas: ${telegramReady(s) ? 'Telegram' : 'Webhook'}` : 'Alertas sin configurar'}
            {queued > 0 ? ` · ${queued} en cola` : ''}
          </span>
          <button className="ghost" onClick={() => setShowCfg((v) => !v)}>
            ⚙ Ajustes
          </button>
          {running ? (
            <button className="btn stop" onClick={dms.stop}>
              Detener
            </button>
          ) : (
            <button className="btn" onClick={dms.start} disabled={status === 'loading'}>
              {status === 'loading' ? 'Cargando…' : 'Iniciar monitoreo'}
            </button>
          )}
        </div>
      </header>

      <AnimatePresence>
        {showCfg && (
          <motion.section
            className="cfg"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
          >
            <div className="cfg-grid">
              <label>
                Telegram: token del bot
                <input type="password" placeholder="123456:ABC..." value={s.telegramToken} onChange={(e) => set('telegramToken', e.target.value.trim())} />
              </label>
              <label>
                Telegram: ID del grupo/chat
                <input placeholder="-1001234567890" value={s.telegramChatId} onChange={(e) => set('telegramChatId', e.target.value.trim())} />
              </label>
              <label>
                Webhook de correo (opcional)
                <input placeholder="https://mi-servidor/api/alert" value={s.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value.trim())} />
              </label>
              <label>
                Correo destino (si usas webhook)
                <input type="email" placeholder="supervisor@empresa.com" value={s.to} onChange={(e) => set('to', e.target.value)} />
              </label>
              <label>
                Conductor
                <input value={s.driver} onChange={(e) => set('driver', e.target.value)} />
              </label>
              <label>
                Vehículo / placa
                <input value={s.vehicle} onChange={(e) => set('vehicle', e.target.value)} />
              </label>
              <label>
                Ojos cerrados: {s.drowsySec}s
                <input type="range" min="0.5" max="4" step="0.1" value={s.drowsySec} onChange={(e) => set('drowsySec', +e.target.value)} />
              </label>
              <label>
                Mirada fuera: {s.distractionSec}s
                <input type="range" min="1" max="8" step="0.5" value={s.distractionSec} onChange={(e) => set('distractionSec', +e.target.value)} />
              </label>
              <label>
                Ángulo de giro: {s.yawDeg}°
                <input type="range" min="10" max="50" step="1" value={s.yawDeg} onChange={(e) => set('yawDeg', +e.target.value)} />
              </label>
              <label>
                Pausa entre correos: {s.cooldownSec}s
                <input type="range" min="5" max="120" step="5" value={s.cooldownSec} onChange={(e) => set('cooldownSec', +e.target.value)} />
              </label>
              <label>
                Rendimiento del análisis
                <select value={s.perf} onChange={(e) => set('perf', e.target.value)}>
                  <option value="alto">Alto (más preciso, más CPU)</option>
                  <option value="balanceado">Balanceado (recomendado)</option>
                  <option value="ahorro">Ahorro (equipos lentos)</option>
                </select>
              </label>
              <label>
                Límite mensual de datos: {s.dataLimitGB > 0 ? `${s.dataLimitGB} GB` : 'sin límite'}
                <input type="number" min="0" step="0.5" value={s.dataLimitGB} onChange={(e) => set('dataLimitGB', Math.max(0, +e.target.value))} />
              </label>
              <label>
                Avisar a coordinación al llegar a: {s.dataWarnPct}%
                <input type="range" min="50" max="95" step="5" value={s.dataWarnPct} onChange={(e) => set('dataWarnPct', +e.target.value)} />
              </label>
              <label className="chk consent">
                <input type="checkbox" checked={s.liveEnabled} onChange={(e) => set('liveEnabled', e.target.checked)} />
                Permitir que coordinación vea y escuche la cabina (el conductor fue informado y consintió)
              </label>
              <label>
                Código de flota
                <input placeholder="ej: transportes-andes-7x9k" value={s.fleet} onChange={(e) => set('fleet', e.target.value.trim())} />
              </label>
              <label>
                ID de este vehículo
                <input placeholder="ej: bus-014" value={s.vehicleId} onChange={(e) => set('vehicleId', e.target.value.trim())} />
              </label>
              <label>
                PIN de acceso (coordinadores)
                <input type="password" placeholder="mínimo 6 caracteres" value={s.pin} onChange={(e) => set('pin', e.target.value)} />
              </label>
              <label>
                Servidores TURN (JSON, opcional)
                <input placeholder='[{"urls":"turn:...","username":"..","credential":".."}]' value={s.ice} onChange={(e) => set('ice', e.target.value)} />
              </label>
              <label className="chk">
                <input type="checkbox" checked={s.sound} onChange={(e) => set('sound', e.target.checked)} /> Alarma sonora
              </label>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <main>
        <section className="left">
          <motion.div
            className="cam"
            animate={{
              boxShadow: top ? `0 0 0 3px ${ALERTS[top].color}, 0 0 40px ${ALERTS[top].color}88` : '0 0 0 1px #1e293b',
            }}
          >
            <video ref={videoRef} playsInline muted />
            <canvas ref={canvasRef} />
            {!running && (
              <div className="ph">
                <div className="scan" />
                <p>
                  {status === 'loading'
                    ? 'Cargando modelos de IA…'
                    : status === 'error'
                    ? `Error: ${error}`
                    : 'Presiona “Iniciar monitoreo” y permite el acceso a la cámara'}
                </p>
              </div>
            )}
            <AnimatePresence>
              {top && (
                <motion.div
                  key={top}
                  className="banner"
                  style={{ background: ALERTS[top].color }}
                  initial={{ y: -60, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -60, opacity: 0 }}
                >
                  <motion.span animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 0.7 }}>
                    ⚠
                  </motion.span>
                  {ALERTS[top].label}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          <div className="chips">
            <Chip on={flags.eyesClosed} label="Ojos cerrados" color={ALERTS.drowsy.color} />
            <Chip on={flags.away} label="Mirada desviada" color={ALERTS.distraction.color} />
            <Chip on={flags.phone} label="Celular" color={ALERTS.phone.color} />
            <Chip on={flags.noface} label="Sin rostro" color={ALERTS.noface.color} />
          </div>
        </section>

        <aside>
          <div className="card center">
            <Gauge value={m.awareness} />
            <Spark data={history} />
            <div className="btn-row">
              <button className="ghost" onClick={dms.calibrate} disabled={!running}>
                ◎ Calibrar (mirando al frente)
              </button>
              <button className="ghost" onClick={dms.testAlert} disabled={!running}>
                ✉ Probar alerta
              </button>
            </div>
          </div>
          <div className="stats">
            <Stat label="Parpadeo" value={Math.round(m.blink * 100)} unit="%" bad={flags.eyesClosed} />
            <Stat label="PERCLOS 30s" value={Math.round(m.perclos * 100)} unit="%" bad={m.perclos > 0.25} />
            <Stat label="Giro (yaw)" value={Math.round(m.yaw)} unit="°" bad={flags.away} />
            <Stat label="Inclinación" value={Math.round(m.pitch)} unit="°" bad={flags.away} />
          </div>
          <div className="card data">
            <h3>
              Consumo de datos <span>{new Date().toLocaleString('es', { month: 'long' })}</span>
            </h3>
            <div className="dbar">
              <motion.div
                animate={{
                  width: `${usage.limit ? Math.min(100, usage.pct) : 0}%`,
                  background: usage.level === 'limit' ? '#ef4444' : usage.level === 'warn' ? '#f59e0b' : '#22c55e',
                }}
              />
            </div>
            <div className="drow">
              <b>{fmtBytes(usage.used)}</b>
              <small>{usage.limit ? `de ${s.dataLimitGB} GB · ${Math.round(usage.pct)}%` : 'sin límite configurado'}</small>
            </div>
            <div className="drow">
              <small>Video en vivo {fmtBytes(usage.live)} · Alertas {fmtBytes(usage.alerts)}</small>
              <button className="lnk" onClick={() => window.confirm('¿Reiniciar el contador de datos?') && usage.reset()}>
                Reiniciar
              </button>
            </div>
          </div>
          <div className="card log">
            <h3>
              Eventos <span>{events.length}</span>
            </h3>
            <div className="list">
              {events.length === 0 && <p className="empty">Sin eventos todavía.</p>}
              <AnimatePresence initial={false}>
                {events.map((e) => (
                  <motion.div key={e.id} layout className="ev" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <img src={e.image} alt="" />
                    <div>
                      <b style={{ color: ALERTS[e.type].color }}>{e.label}</b>
                      <small>{e.time}</small>
                      <em className={e.emailStatus}>{mailTxt[e.emailStatus]}</em>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </aside>
      </main>
    </div>
  )
}
