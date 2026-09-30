import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ALERTS } from '../alerts.js'
import { useFleet } from './useFleet.js'
import { fmtBytes } from '../format.js'

const DEFAULTS = { fleet: '', pin: '', vehicles: '', ice: '', sound: true }
const scoreColor = (v) => (v > 70 ? '#22c55e' : v > 40 ? '#f59e0b' : '#ef4444')
const STATUS = {
  online: ['En línea', '#22c55e'],
  connecting: ['Conectando…', '#f59e0b'],
  offline: ['Sin conexión', '#64748b'],
  denied: ['PIN incorrecto', '#ef4444'],
}

function useSettings() {
  const [s, setS] = useState(() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('dms-coord') || '{}') }
    } catch {
      return DEFAULTS
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('dms-coord', JSON.stringify(s))
    } catch {}
  }, [s])
  return [s, (k, v) => setS((p) => ({ ...p, [k]: v }))]
}

// Barras de nivel de audio de la cabina
function Meter({ stream, active }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!stream || !stream.getAudioTracks().length) return
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const an = ctx.createAnalyser()
    an.fftSize = 64
    ctx.createMediaStreamSource(stream).connect(an)
    const buf = new Uint8Array(an.frequencyBinCount)
    let raf
    const draw = () => {
      raf = requestAnimationFrame(draw)
      an.getByteFrequencyData(buf)
      const bars = ref.current?.children
      if (!bars) return
      for (let i = 0; i < bars.length; i++) bars[i].style.height = `${8 + (buf[i + 1] / 255) * 92}%`
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      ctx.close()
    }
  }, [stream, active])
  return (
    <div className="meter" ref={ref}>
      {Array.from({ length: 16 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  )
}

function LivePanel({ vid, tel, stream, onStop, onQuality }) {
  const v = useRef(null)
  const [q, setQ] = useState('media')
  const [muted, setMuted] = useState(false)
  useEffect(() => {
    if (v.current && stream) {
      v.current.srcObject = stream
      v.current.play().catch(() => setMuted(true)) // si el navegador bloquea el audio, arranca en mudo
    }
  }, [stream])
  useEffect(() => {
    if (v.current) v.current.muted = muted
  }, [muted])
  const hasAudio = !!stream?.getAudioTracks().length
  const snap = () => {
    const el = v.current
    if (!el?.videoWidth) return
    const c = document.createElement('canvas')
    c.width = el.videoWidth
    c.height = el.videoHeight
    c.getContext('2d').drawImage(el, 0, 0)
    const a = document.createElement('a')
    a.href = c.toDataURL('image/jpeg', 0.9)
    a.download = `${vid}-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`
    a.click()
  }
  const top = tel?.active?.[0]
  return (
    <motion.div className="live" layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
      <div className="live-vid" style={{ boxShadow: top ? `0 0 0 3px ${ALERTS[top].color}` : 'none' }}>
        <video ref={v} playsInline autoPlay />
        {!stream && <div className="ph"><div className="scan" /><p>Solicitando cabina de {vid}…</p></div>}
        <span className="tag rec">● EN VIVO</span>
        {top && <span className="tag" style={{ background: ALERTS[top].color }}>⚠ {ALERTS[top].label}</span>}
      </div>
      <div className="live-bar">
        <div>
          <b>{tel?.vehicle || vid}</b>
          <small>{tel?.driver}</small>
        </div>
        <div className="live-ctl">
          <div className="qsel">
            {['baja', 'media', 'alta'].map((l) => (
              <button key={l} className={q === l ? 'on' : ''} onClick={() => { setQ(l); onQuality(l) }}>{l}</button>
            ))}
          </div>
          {hasAudio ? <Meter stream={stream} /> : <small>{stream ? 'Sin audio' : ''}</small>}
          <button className="ghost" onClick={() => setMuted((m) => !m)}>{muted ? '🔇 Activar audio' : '🔊 Silenciar'}</button>
          <button className="ghost" onClick={snap}>📸 Captura</button>
          <button className="ghost" onClick={() => v.current?.requestFullscreen?.()}>⛶</button>
          <button className="btn stop" onClick={onStop}>Cerrar</button>
        </div>
      </div>
    </motion.div>
  )
}

function Card({ vid, d, watching, onWatch }) {
  const [label, color] = STATUS[d?.status || 'offline']
  const t = d?.tel
  const online = d?.status === 'online'
  const kmh = t?.pos?.speed != null ? Math.round(t.pos.speed * 3.6) : null
  return (
    <motion.div layout className="vcard" animate={{ borderColor: t?.active?.length ? ALERTS[t.active[0]].color : '#1e293b' }}>
      <div className="vc-h">
        <div>
          <b>{t?.vehicle || vid}</b>
          <small>{t?.driver || vid}</small>
        </div>
        <span className="st"><i style={{ background: color }} />{label}</span>
      </div>
      {online && t ? (
        <>
          <div className="aw">
            <div className="aw-n" style={{ color: scoreColor(t.awareness) }}>{t.awareness}<small>%</small></div>
            <div className="aw-bar"><motion.div animate={{ width: `${t.awareness}%`, background: scoreColor(t.awareness) }} /></div>
          </div>
          {t.data && (
            <div className="dat">
              <div className="dbar">
                <motion.div
                  animate={{
                    width: `${t.data.limit ? Math.min(100, (t.data.used / t.data.limit) * 100) : 0}%`,
                    background: t.data.level === 'limit' ? '#ef4444' : t.data.level === 'warn' ? '#f59e0b' : '#22c55e',
                  }}
                />
              </div>
              <small>
                Datos: {fmtBytes(t.data.used)}
                {t.data.limit ? ` / ${fmtBytes(t.data.limit)}` : ''}
              </small>
            </div>
          )}
          <div className="vc-tags">
            <AnimatePresence>
              {(t.active || []).map((a) => (
                <motion.span key={a} className="badge" style={{ background: ALERTS[a].color }} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  {ALERTS[a].label}
                </motion.span>
              ))}
            </AnimatePresence>
            {!t.active?.length && <span className="ok-t">Conducción normal</span>}
          </div>
          <div className="vc-f">
            <span>{kmh != null ? `${kmh} km/h` : 'Sin velocidad'}</span>
            {t.pos && <a href={`https://maps.google.com/?q=${t.pos.lat},${t.pos.lon}`} target="_blank" rel="noreferrer">📍 Mapa</a>}
          </div>
          <button className="btn" disabled={watching} onClick={onWatch}>{watching ? 'Viendo…' : '🎥 Ver y escuchar cabina'}</button>
        </>
      ) : (
        <p className="empty">{d?.status === 'denied' ? 'Revisa el PIN en Ajustes.' : 'Esperando al vehículo…'}</p>
      )}
    </motion.div>
  )
}

export default function Coordinator() {
  const [s, set] = useSettings()
  const [showCfg, setShowCfg] = useState(!s.fleet)
  const [open, setOpen] = useState([]) // vehículos con panel en vivo
  const vehicles = useMemo(() => [...new Set(s.vehicles.split(/[\s,;]+/).map((v) => v.trim()).filter(Boolean))], [s.vehicles])
  const fleet = useFleet({ fleet: s.fleet, pin: s.pin, vehicles, ice: s.ice, sound: s.sound })
  const { peerState, data, streams, feed } = fleet

  const watch = (vid) => {
    setOpen((o) => (o.includes(vid) ? o : [...o, vid]))
    fleet.watch(vid, true)
  }
  const stop = (vid) => {
    fleet.stopWatch(vid)
    setOpen((o) => o.filter((x) => x !== vid))
  }
  const online = vehicles.filter((v) => data[v]?.status === 'online').length
  const alerting = vehicles.filter((v) => data[v]?.tel?.active?.length).length

  return (
    <div className="app coord">
      <header>
        <div className="brand">
          <motion.span className="dot" animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1.6 }} style={{ background: '#3b82f6', color: '#3b82f6' }} />
          <h1>Centro de control <small>Flota en vivo</small></h1>
        </div>
        <div className="head-r">
          <span className="pill ok">{online}/{vehicles.length} en línea</span>
          {alerting > 0 && <span className="pill live">⚠ {alerting} con alerta</span>}
          <span className={`pill ${peerState === 'ready' ? 'ok' : 'no'}`}>
            {peerState === 'ready' ? 'Señalización OK' : peerState === 'error' ? 'Sin señalización' : peerState === 'connecting' ? 'Conectando…' : 'Sin configurar'}
          </span>
          <button className="ghost" onClick={() => setShowCfg((v) => !v)}>⚙ Ajustes</button>
        </div>
      </header>

      <AnimatePresence>
        {showCfg && (
          <motion.section className="cfg" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
            <div className="cfg-grid">
              <label>Código de flota
                <input value={s.fleet} placeholder="el mismo que en los vehículos" onChange={(e) => set('fleet', e.target.value.trim())} />
              </label>
              <label>PIN de acceso
                <input type="password" value={s.pin} onChange={(e) => set('pin', e.target.value)} />
              </label>
              <label style={{ gridColumn: '1/-1' }}>IDs de vehículos (separados por coma)
                <input value={s.vehicles} placeholder="bus-014, bus-015, camion-02" onChange={(e) => set('vehicles', e.target.value)} />
              </label>
              <label>Servidores TURN (JSON, opcional)
                <input value={s.ice} placeholder='[{"urls":"turn:...","username":"..","credential":".."}]' onChange={(e) => set('ice', e.target.value)} />
              </label>
              <label className="chk">
                <input type="checkbox" checked={s.sound} onChange={(e) => set('sound', e.target.checked)} /> Sonido al llegar una alerta
              </label>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <div className="c-main">
        <section>
          <AnimatePresence>
            {open.map((vid) => (
              <LivePanel key={vid} vid={vid} tel={data[vid]?.tel} stream={streams[vid]} onStop={() => stop(vid)} onQuality={(l) => fleet.setQuality(vid, l)} />
            ))}
          </AnimatePresence>
          {vehicles.length === 0 && <p className="empty big">Agrega los IDs de tus vehículos en Ajustes para empezar.</p>}
          <div className="vgrid">
            {vehicles.map((vid) => (
              <Card key={vid} vid={vid} d={data[vid]} watching={open.includes(vid)} onWatch={() => watch(vid)} />
            ))}
          </div>
        </section>
        <aside>
          <div className="card log">
            <h3>Alertas en vivo <span>{feed.length}</span></h3>
            <div className="list">
              {feed.length === 0 && <p className="empty">Sin alertas todavía.</p>}
              <AnimatePresence initial={false}>
                {feed.map((f) => (
                  <motion.div key={f.id} layout className="ev fe" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    <i style={{ background: ALERTS[f.type].color }} />
                    <div>
                      <b style={{ color: ALERTS[f.type].color }}>{ALERTS[f.type].label}</b>
                      {f.detail && <small>{f.detail}</small>}
                      <small>{f.vehicle || f.vid} · {f.driver} · {new Date(f.ts).toLocaleTimeString()}</small>
                      <span>
                        {f.type !== 'data' && <button className="lnk" onClick={() => watch(f.vid)}>🎥 Ver cabina</button>}
                        {f.pos && <a href={`https://maps.google.com/?q=${f.pos.lat},${f.pos.lon}`} target="_blank" rel="noreferrer">📍 Mapa</a>}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
