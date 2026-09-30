import { useEffect, useState } from 'react'
import Peer from 'peerjs'
import { parseIce, peerIdFor } from './ice.js'
import { addData } from './dataUsage.js'

// Perfiles de calidad del video en vivo (el coordinador elige; 'media' por defecto)
const QUALITY = {
  alta: { maxBitrate: 1800000, scaleResolutionDownBy: 1, maxFramerate: 30 },
  media: { maxBitrate: 900000, scaleResolutionDownBy: 1.5, maxFramerate: 24 },
  baja: { maxBitrate: 300000, scaleResolutionDownBy: 2.5, maxFramerate: 15 },
}

function applyQuality(call, level) {
  const q = QUALITY[level] || QUALITY.media
  call?.peerConnection?.getSenders().forEach(async (se) => {
    if (se.track?.kind !== 'video') return
    try {
      const p = se.getParameters()
      p.encodings = [{ ...(p.encodings?.[0] || {}), ...q }]
      await se.setParameters(p)
    } catch {}
  })
}

// Vehículo: se registra como peer, autentica coordinadores por PIN y, cuando uno lo pide,
// les envía video de cabina + audio (WebRTC, cifrado extremo a extremo, sin pasar por un servidor).
// telRef.current() debe devolver la telemetría actual del vehículo.
export function useLiveBroadcast({ settings: s, running, streamRef, telRef }) {
  const [viewers, setViewers] = useState(0)
  const [state, setState] = useState('off') // off | connecting | ready | error
  const enabled = !!(running && s.liveEnabled && s.fleet && s.vehicleId && s.pin)

  useEffect(() => {
    if (!enabled) {
      setState('off')
      setViewers(0)
      return
    }
    let dead = false
    let peer = null
    let retry = 0
    let mic = null
    const conns = new Set()
    const calls = new Map() // id del coordinador -> llamada
    const levels = new Map() // id del coordinador -> calidad elegida
    const id = peerIdFor(s.fleet, s.vehicleId)

    const stopMicIfIdle = () => {
      if (calls.size === 0 && mic) {
        mic.getTracks().forEach((t) => t.stop())
        mic = null
      }
    }
    const upd = () => {
      setViewers(calls.size)
      stopMicIfIdle()
    }
    const getMic = async () => {
      if (mic) return mic
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
          video: false,
        })
      } catch {
        mic = null
      }
      return mic
    }
    const chime = () => {
      // Aviso sonoro al conductor: transparencia cuando coordinación empieza a ver la cabina
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const o = ctx.createOscillator()
        const g = ctx.createGain()
        o.frequency.value = 660
        g.gain.setValueAtTime(0.2, ctx.currentTime)
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
        o.connect(g).connect(ctx.destination)
        o.start()
        o.stop(ctx.currentTime + 0.55)
        setTimeout(() => ctx.close(), 800)
      } catch {}
    }
    const stopCall = (pid) => {
      const c = calls.get(pid)
      if (c) {
        try {
          c.close()
        } catch {}
        calls.delete(pid)
        upd()
      }
    }
    const startCall = async (pid, wantAudio) => {
      stopCall(pid)
      const vt = streamRef.current?.getVideoTracks()[0]
      if (!vt || !peer) return
      vt.contentHint = 'motion' // prioriza fluidez (fps) sobre nitidez
      const ms = new MediaStream([vt])
      if (wantAudio) (await getMic())?.getAudioTracks().forEach((t) => ms.addTrack(t))
      if (dead) return
      const call = peer.call(pid, ms)
      calls.set(pid, call)
      upd()
      chime()
      call.on('close', () => {
        if (calls.get(pid) === call) {
          calls.delete(pid)
          upd()
        }
      })
      call.on('error', () => stopCall(pid))
      // Aplica calidad tras negociar (se repite porque el navegador puede reiniciar los parámetros)
      ;[1200, 4000].forEach((ms) => setTimeout(() => applyQuality(call, levels.get(pid)), ms))
    }

    const create = () => {
      if (dead) return
      setState('connecting')
      peer = new Peer(id, { config: { iceServers: parseIce(s.ice) } })
      peer.on('open', () => {
        retry = 0
        setState('ready')
      })
      peer.on('connection', (conn) => {
        let auth = false
        conn.on('data', (m) => {
          if (!auth) {
            if (m?.t === 'auth' && m.pin === s.pin) {
              auth = true
              conns.add(conn)
              conn.send({ t: 'ok' })
            } else {
              conn.send({ t: 'denied' })
              setTimeout(() => conn.close(), 300)
            }
            return
          }
          if (m?.t === 'watch') startCall(conn.peer, m.audio !== false)
          else if (m?.t === 'stop') stopCall(conn.peer)
          else if (m?.t === 'quality') {
            levels.set(conn.peer, m.level)
            applyQuality(calls.get(conn.peer), m.level)
          }
        })
        conn.on('close', () => {
          conns.delete(conn)
          stopCall(conn.peer)
        })
        conn.on('error', () => {})
      })
      peer.on('disconnected', () => {
        if (!dead) peer.reconnect()
      })
      peer.on('close', () => {
        if (!dead) setTimeout(create, Math.min(30000, 3000 * ++retry))
      })
      peer.on('error', (e) => {
        if (['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
          setState('error')
          try {
            peer.destroy() // dispara 'close' -> reintento con espera creciente
          } catch {}
        }
      })
    }
    create()

    // Cuenta datos móviles reales (enviados + recibidos) de cada conexión WebRTC
    const last = new WeakMap()
    const poll = async () => {
      const pcs = [...calls.values(), ...conns].map((c) => c.peerConnection).filter(Boolean)
      for (const pc of pcs) {
        try {
          const rep = await pc.getStats()
          rep.forEach((r) => {
            if (r.type !== 'candidate-pair' || !r.nominated || r.state !== 'succeeded') return
            const b = (r.bytesSent || 0) + (r.bytesReceived || 0)
            const p = last.get(pc)
            const delta = p && p.id === r.id ? b - p.bytes : b
            last.set(pc, { id: r.id, bytes: b })
            addData('live', delta)
          })
        } catch {}
      }
    }
    const statsIv = setInterval(poll, 3000)

    const iv = setInterval(() => {
      const msg = { t: 'tel', ...telRef.current(), ts: Date.now(), viewers: calls.size }
      conns.forEach((c) => c.open && c.send(msg))
    }, 1000)

    return () => {
      dead = true
      clearInterval(iv)
      clearInterval(statsIv)
      calls.forEach((c) => {
        try {
          c.close()
        } catch {}
      })
      calls.clear()
      mic?.getTracks().forEach((t) => t.stop())
      try {
        peer?.destroy()
      } catch {}
      setViewers(0)
      setState('off')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, s.fleet, s.vehicleId, s.pin, s.ice])

  return { viewers, liveState: state }
}
