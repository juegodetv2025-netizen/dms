import { useCallback, useEffect, useRef, useState } from 'react'
import Peer from 'peerjs'
import { parseIce, peerIdFor } from '../ice.js'

function beepAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'square'
    o.frequency.value = 780
    g.gain.setValueAtTime(0.15, ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4)
    o.connect(g).connect(ctx.destination)
    o.start()
    o.stop(ctx.currentTime + 0.45)
    setTimeout(() => ctx.close(), 700)
  } catch {}
}

// Coordinador: mantiene una conexión de datos (telemetría) con cada vehículo y,
// bajo demanda, recibe su video/audio. Vehículo y coordinador se autentican por PIN.
export function useFleet({ fleet, pin, vehicles, ice, sound }) {
  const [peerState, setPeerState] = useState('off') // off | connecting | ready | error
  const [data, setData] = useState({}) // vid -> { status, tel, last }
  const [streams, setStreams] = useState({}) // vid -> MediaStream
  const [feed, setFeed] = useState([])
  const connsRef = useRef({})
  const callsRef = useRef({})
  const prevAlerts = useRef({})
  const prevData = useRef({})
  const soundRef = useRef(sound)
  soundRef.current = sound
  const key = vehicles.join('|')

  useEffect(() => {
    if (!fleet || !pin || !vehicles.length) {
      setPeerState('off')
      return
    }
    let dead = false
    const timers = new Set()
    setPeerState('connecting')
    const peer = new Peer({ config: { iceServers: parseIce(ice) } })
    const idOf = (vid) => peerIdFor(fleet, vid)
    const vidOf = (pid) => vehicles.find((v) => idOf(v) === pid)

    const setV = (vid, patch, keepDenied) =>
      setData((d) => (keepDenied && d[vid]?.status === 'denied' ? d : { ...d, [vid]: { ...d[vid], ...patch } }))
    const dropStream = (vid) => {
      delete callsRef.current[vid]
      setStreams((x) => {
        if (!x[vid]) return x
        const { [vid]: _, ...rest } = x
        return rest
      })
    }
    const later = (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
    }
    const checkAlerts = (vid, m) => {
      const cur = m.active || []
      const prev = prevAlerts.current[vid] || []
      const fresh = cur.filter((a) => !prev.includes(a))
      prevAlerts.current[vid] = cur
      const base = { vid, driver: m.driver, vehicle: m.vehicle, ts: Date.now(), pos: m.pos }
      const items = fresh.map((a) => ({ id: crypto.randomUUID(), type: a, ...base }))
      // Aviso de consumo de datos móviles (al cambiar de nivel)
      const dl = m.data?.level || 'ok'
      if (dl !== 'ok' && dl !== (prevData.current[vid] || 'ok'))
        items.push({
          id: crypto.randomUUID(),
          type: 'data',
          detail: dl === 'limit' ? 'Superó el límite mensual de datos' : 'Cerca del límite mensual de datos',
          ...base,
        })
      prevData.current[vid] = dl
      if (!items.length) return
      setFeed((f) => [...items, ...f].slice(0, 50))
      if (soundRef.current) beepAlert()
    }

    const connect = (vid) => {
      if (dead || connsRef.current[vid]?.open) return
      const conn = peer.connect(idOf(vid), { reliable: true })
      connsRef.current[vid] = conn
      conn.on('open', () => conn.send({ t: 'auth', pin }))
      conn.on('data', (m) => {
        if (m.t === 'ok') setV(vid, { status: 'online' })
        else if (m.t === 'denied') setV(vid, { status: 'denied' })
        else if (m.t === 'tel') {
          setV(vid, { status: 'online', tel: m, last: Date.now() })
          checkAlerts(vid, m)
        }
      })
      conn.on('close', () => {
        setV(vid, { status: 'offline' }, true)
        dropStream(vid)
        later(() => connect(vid), 6000)
      })
      conn.on('error', () => {})
    }

    peer.on('open', () => {
      setPeerState('ready')
      vehicles.forEach((v) => {
        setV(v, { status: 'connecting' })
        connect(v)
      })
    })
    peer.on('call', (call) => {
      const vid = vidOf(call.peer)
      if (!vid) return call.close()
      call.answer() // el coordinador solo recibe; no envía video ni audio
      callsRef.current[vid] = call
      call.on('stream', (s) => {
        setStreams((x) => ({ ...x, [vid]: s }))
        // Buffer de reproducción pequeño = menos retraso (Chrome/Edge)
        call.peerConnection?.getReceivers().forEach((r) => {
          if ('jitterBufferTarget' in r) r.jitterBufferTarget = 150
        })
      })
      call.on('close', () => dropStream(vid))
    })
    peer.on('disconnected', () => !dead && peer.reconnect())
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') {
        const vid = vehicles.find((v) => String(e.message).includes(idOf(v)))
        if (vid) {
          setV(vid, { status: 'offline' }, true)
          later(() => connect(vid), 8000)
        }
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) setPeerState('error')
    })

    return () => {
      dead = true
      timers.forEach(clearTimeout)
      Object.values(callsRef.current).forEach((c) => c.close())
      callsRef.current = {}
      connsRef.current = {}
      try {
        peer.destroy()
      } catch {}
      setStreams({})
      setData({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet, pin, key, ice])

  const watch = useCallback((vid, audio = true) => connsRef.current[vid]?.open && connsRef.current[vid].send({ t: 'watch', audio }), [])
  const setQuality = useCallback((vid, level) => connsRef.current[vid]?.open && connsRef.current[vid].send({ t: 'quality', level }), [])
  const stopWatch = useCallback((vid) => {
    connsRef.current[vid]?.open && connsRef.current[vid].send({ t: 'stop' })
    callsRef.current[vid]?.close()
    delete callsRef.current[vid]
    setStreams((x) => {
      const { [vid]: _, ...rest } = x
      return rest
    })
  }, [])

  return { peerState, data, streams, feed, watch, stopWatch, setQuality }
}
