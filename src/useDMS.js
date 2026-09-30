import { useCallback, useEffect, useRef, useState } from 'react'
import { FilesetResolver, FaceLandmarker, ObjectDetector } from '@mediapipe/tasks-vision'

import { notify, flushQueue, queueSize } from './notify.js'
import { ALERTS } from './alerts.js'

// Todo se sirve desde la propia app (public/), así funciona sin internet.
const BASE = import.meta.env.BASE_URL
const WASM = `${BASE}wasm`
const FACE_MODEL = `${BASE}models/face_landmarker.task`
const OBJ_MODEL = `${BASE}models/efficientdet_lite0.tflite`

export { ALERTS }

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const deg = (r) => (r * 180) / Math.PI

async function createModels() {
  const fileset = await FilesetResolver.forVisionTasks(WASM)
  const make = async (delegate) => {
    const face = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
    })
    const obj = await ObjectDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: OBJ_MODEL, delegate },
      runningMode: 'VIDEO',
      scoreThreshold: 0.3,
      categoryAllowlist: ['cell phone'],
      maxResults: 3,
    })
    return { face, obj }
  }
  try {
    return await make('GPU')
  } catch (e) {
    console.warn('GPU no disponible, usando CPU', e)
    return await make('CPU')
  }
}

// Sirena fuerte de dos tonos (alterna 880/1320 Hz). El volumen final depende del volumen del equipo.
function beep(ctx) {
  const t0 = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = 1
  const comp = ctx.createDynamicsCompressor() // sube el volumen percibido sin distorsionar
  master.connect(comp).connect(ctx.destination)
  ;[880, 1320, 880, 1320].forEach((f, k) => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'square'
    o.frequency.value = f
    const a = t0 + k * 0.2
    g.gain.setValueAtTime(0.0001, a)
    g.gain.exponentialRampToValueAtTime(0.9, a + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, a + 0.19)
    o.connect(g).connect(master)
    o.start(a)
    o.stop(a + 0.2)
  })
}

export function useDMS({ videoRef, canvasRef, settings }) {
  const [status, setStatus] = useState('idle') // idle | loading | running | error
  const [error, setError] = useState('')
  const [metrics, setMetrics] = useState({ awareness: 100, blink: 0, yaw: 0, pitch: 0, roll: 0, perclos: 0, fps: 0 })
  const [flags, setFlags] = useState({ eyesClosed: false, away: false, tilt: false, phone: false, noface: false })
  const [active, setActive] = useState([])
  const [history, setHistory] = useState(() => Array(60).fill(100))
  const [events, setEvents] = useState([])

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const modelsRef = useRef(null)
  const rafRef = useRef(0)
  const streamRef = useRef(null)
  const geoRef = useRef({ id: null, pos: null })
  const calRef = useRef({ yaw: 0, pitch: 0, roll: 0 })
  const lastPoseRef = useRef({ yaw: 0, pitch: 0, roll: 0 })
  const audioRef = useRef(null)
  const runningRef = useRef(false)
  const wakeRef = useRef(null)
  const visRef = useRef(null)

  const snapshot = useCallback((label) => {
    const v = videoRef.current
    const o = canvasRef.current
    if (!v || !v.videoWidth) return null
    const scale = Math.min(1, 960 / v.videoWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    const ctx = c.getContext('2d')
    ctx.drawImage(v, 0, 0, c.width, c.height)
    if (o) ctx.drawImage(o, 0, 0, c.width, c.height)
    ctx.fillStyle = 'rgba(0,0,0,0.65)'
    ctx.fillRect(0, c.height - 34, c.width, 34)
    ctx.fillStyle = '#fff'
    ctx.font = '16px sans-serif'
    ctx.fillText(`${label} · ${new Date().toLocaleString()}`, 12, c.height - 11)
    return c.toDataURL('image/jpeg', 0.82)
  }, [videoRef, canvasRef])

  const [queued, setQueued] = useState(queueSize())
  const [online, setOnline] = useState(navigator.onLine)

  const sendEmail = useCallback(async (evt, awareness) => {
    const s = settingsRef.current
    const patch = (emailStatus) =>
      setEvents((es) => es.map((e) => (e.id === evt.id ? { ...e, emailStatus } : e)))
    patch('sending')
    const p = geoRef.current.pos
    const result = await notify(s, {
      type: evt.type,
      label: evt.label,
      driver: s.driver,
      vehicle: s.vehicle,
      image: evt.image,
      time: evt.time,
      location: p ? `https://maps.google.com/?q=${p.latitude},${p.longitude}` : null,
      awareness: Math.round(awareness),
    })
    patch(result)
    setQueued(queueSize())
  }, [])

  // Reenvío automático de alertas en cola
  useEffect(() => {
    const tick = async () => setQueued(await flushQueue(settingsRef.current))
    const on = () => {
      setOnline(true)
      tick()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const id = setInterval(tick, 30000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      clearInterval(id)
    }
  }, [])

  const fireEvent = useCallback(
    (type, awareness) => {
      const label = ALERTS[type].label
      const image = snapshot(label)
      if (!image) return
      const evt = {
        id: crypto.randomUUID(),
        type,
        label,
        image,
        time: new Date().toLocaleString(),
        emailStatus: 'off',
      }
      setEvents((es) => [evt, ...es].slice(0, 30))
      sendEmail(evt, awareness)
    },
    [snapshot, sendEmail]
  )

  const stop = useCallback(() => {
    runningRef.current = false
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (visRef.current) document.removeEventListener('visibilitychange', visRef.current)
    visRef.current = null
    wakeRef.current?.release?.().catch(() => {})
    wakeRef.current = null
    if (geoRef.current.id != null) navigator.geolocation?.clearWatch(geoRef.current.id)
    const c = canvasRef.current
    c?.getContext('2d').clearRect(0, 0, c.width, c.height)
    setActive([])
    setStatus('idle')
  }, [canvasRef])

  const start = useCallback(async () => {
    try {
      setError('')
      setStatus('loading')
      audioRef.current ||= new (window.AudioContext || window.webkitAudioContext)()
      audioRef.current.resume?.()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 }, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      const v = videoRef.current
      v.srcObject = stream
      await v.play()
      navigator.geolocation?.getCurrentPosition(() => {}, () => {})
      geoRef.current.id = navigator.geolocation?.watchPosition(
        (p) => (geoRef.current.pos = p.coords),
        () => {},
        { enableHighAccuracy: true }
      )
      modelsRef.current ||= await createModels()
      // Mantener la pantalla encendida mientras se monitorea (se re-solicita al volver a la app)
      const lock = async () => {
        try {
          if (runningRef.current) wakeRef.current = await navigator.wakeLock?.request('screen')
        } catch {}
      }
      if (visRef.current) document.removeEventListener('visibilitychange', visRef.current)
      visRef.current = () => document.visibilityState === 'visible' && lock()
      document.addEventListener('visibilitychange', visRef.current)
      runLoop()
      lock()
      setStatus('running')
    } catch (e) {
      console.error(e)
      setError(e.message || String(e))
      setStatus('error')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runLoop = () => {
    const { face: faceLm, obj: objDet } = modelsRef.current
    const v = videoRef.current
    const cv = canvasRef.current
    const ctx = cv.getContext('2d')
    runningRef.current = true

    const since = { drowsy: 0, distraction: 0, tilt: 0, phone: 0, noface: 0 }
    const lastFired = { drowsy: 0, distraction: 0, tilt: 0, phone: 0, noface: 0 }
    const win = [] // ventana PERCLOS
    let awareness = 100
    let phones = []
    let frame = 0
    let lastT = -1
    let lastUi = 0
    let lastInfer = 0
    let lastHist = 0
    let lastBeep = 0
    let fpsCount = 0
    let fpsT = performance.now()
    let fps = 0
    let lastFace = null

    const loop = () => {
      if (!runningRef.current) return
      rafRef.current = requestAnimationFrame(loop)
      if (v.readyState < 2 || v.currentTime === lastT) return
      lastT = v.currentTime
      const now = performance.now()
      const S = settingsRef.current
      // Perfil de rendimiento: limita la inferencia para dejar CPU libre al video en vivo
      const perf = S.perf || 'balanceado'
      if (now - lastInfer < { alto: 0, balanceado: 45, ahorro: 90 }[perf]) return
      lastInfer = now
      if (cv.width !== v.videoWidth) {
        cv.width = v.videoWidth
        cv.height = v.videoHeight
      }
      const W = cv.width
      const H = cv.height

      const fr = faceLm.detectForVideo(v, now)
      if (frame++ % { alto: 3, balanceado: 5, ahorro: 8 }[perf] === 0) {
        const or = objDet.detectForVideo(v, now)
        phones = or.detections.filter((d) => d.categories[0].score > 0.35)
      }

      // ---- métricas ----
      const hasFace = fr.faceLandmarks.length > 0
      let blink = 0
      let yaw = 0
      let pitch = 0
      let roll = 0
      let lookDown = 0
      let eyesClosed = false
      let away = false
      let tilt = false
      if (hasFace) {
        const bs = {}
        fr.faceBlendshapes[0].categories.forEach((c) => (bs[c.categoryName] = c.score))
        blink = (bs.eyeBlinkLeft + bs.eyeBlinkRight) / 2
        lookDown = (bs.eyeLookDownLeft + bs.eyeLookDownRight) / 2
        const d = fr.facialTransformationMatrixes[0].data
        lastPoseRef.current = {
          yaw: deg(Math.atan2(d[8], d[10])),
          pitch: deg(Math.asin(clamp(-d[9], -1, 1))),
          roll: deg(Math.atan2(d[1], d[5])), // inclinación lateral de la cabeza
        }
        yaw = lastPoseRef.current.yaw - calRef.current.yaw
        pitch = lastPoseRef.current.pitch - calRef.current.pitch
        roll = lastPoseRef.current.roll - calRef.current.roll
        eyesClosed = blink > 0.55
        tilt = Math.abs(roll) > (S.tiltDeg || 20)
        away = Math.abs(yaw) > S.yawDeg || Math.abs(pitch) > S.yawDeg * 0.8 || lookDown > 0.65
        lastFace = { lm: fr.faceLandmarks[0], d }
      } else lastFace = null
      const phone = phones.length > 0
      const noface = !hasFace

      win.push({ t: now, c: eyesClosed })
      while (win.length && now - win[0].t > 30000) win.shift()
      const perclos = win.length ? win.filter((w) => w.c).length / win.length : 0

      const cond = { drowsy: eyesClosed, distraction: away && !eyesClosed, tilt: tilt && !eyesClosed, phone, noface }
      const hold = { drowsy: S.drowsySec, distraction: S.distractionSec, tilt: S.tiltSec || 2, phone: 1.2, noface: 4 }
      const act = []
      for (const k of Object.keys(cond)) {
        if (cond[k]) {
          if (!since[k]) since[k] = now
          if ((now - since[k]) / 1000 >= hold[k]) {
            act.push(k)
            if (now - lastFired[k] > S.cooldownSec * 1000) {
              lastFired[k] = now
              fireEventRef.current(k, awareness)
            }
          }
        } else since[k] = 0
      }

      // atención suavizada
      const target = clamp(
        100 - (eyesClosed ? 45 : 0) - (away ? 30 : 0) - (tilt ? 25 : 0) - (phone ? 55 : 0) - (noface ? 60 : 0) - perclos * 60,
        0,
        100
      )
      awareness += (target - awareness) * 0.06

      // sonido
      if (act.length && S.sound && now - lastBeep > 1300) {
        lastBeep = now
        beep(audioRef.current)
      }

      // ---- dibujo ----
      ctx.clearRect(0, 0, W, H)
      const state = act.length ? 'bad' : cond.drowsy || cond.distraction || cond.tilt || cond.phone ? 'warn' : 'ok'
      const col = state === 'bad' ? '#ef4444' : state === 'warn' ? '#f59e0b' : '#22c55e'
      if (lastFace) {
        const { lm, d } = lastFace
        let x0 = 1, y0 = 1, x1 = 0, y1 = 0
        for (const p of lm) {
          if (p.x < x0) x0 = p.x
          if (p.x > x1) x1 = p.x
          if (p.y < y0) y0 = p.y
          if (p.y > y1) y1 = p.y
        }
        const cx = ((x0 + x1) / 2) * W
        const cy = ((y0 + y1) / 2) * H
        const r = Math.max((x1 - x0) * W, (y1 - y0) * H) * 0.68
        ctx.save()
        ctx.lineCap = 'round'
        ctx.shadowColor = col
        ctx.shadowBlur = 22
        ctx.strokeStyle = col
        ctx.globalAlpha = 0.35
        ctx.lineWidth = 16
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.globalAlpha = 1
        ctx.lineWidth = 6
        ctx.setLineDash([r * 0.9, r * 0.35])
        ctx.lineDashOffset = -now / 12
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
        // ojos (iris)
        for (const i of [468, 473]) {
          const p = lm[i]
          if (!p) continue
          const s = 9
          ctx.strokeStyle = eyesClosed ? '#ef4444' : '#facc15'
          ctx.lineWidth = 3
          ctx.strokeRect(p.x * W - s, p.y * H - s, s * 2, s * 2)
        }
        // ejes de pose
        const n = lm[1]
        const L = r * 0.55
        const axes = [
          ['#ef4444', d[0], -d[1]],
          ['#22c55e', d[4], -d[5]],
          ['#3b82f6', d[8], -d[9]],
        ]
        ctx.lineWidth = 4
        for (const [c, ax, ay] of axes) {
          ctx.strokeStyle = c
          ctx.beginPath()
          ctx.moveTo(n.x * W, n.y * H)
          ctx.lineTo(n.x * W + ax * L, n.y * H + ay * L)
          ctx.stroke()
        }
      }
      for (const p of phones) {
        const b = p.boundingBox
        ctx.strokeStyle = '#d946ef'
        ctx.lineWidth = 4
        ctx.shadowColor = '#d946ef'
        ctx.shadowBlur = 14
        ctx.strokeRect(b.originX, b.originY, b.width, b.height)
        ctx.shadowBlur = 0
        ctx.fillStyle = '#d946ef'
        ctx.fillRect(b.originX, b.originY - 26, 150, 26)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 16px sans-serif'
        ctx.fillText(`Celular ${Math.round(p.categories[0].score * 100)}%`, b.originX + 8, b.originY - 8)
      }

      // ---- UI (throttle) ----
      fpsCount++
      if (now - fpsT > 1000) {
        fps = fpsCount
        fpsCount = 0
        fpsT = now
      }
      if (now - lastUi > 100) {
        lastUi = now
        setMetrics({ awareness, blink, yaw, pitch, roll, perclos, fps })
        setFlags({ eyesClosed, away, tilt, phone, noface })
        setActive((prev) => (prev.join() === act.join() ? prev : act))
      }
      if (now - lastHist > 500) {
        lastHist = now
        setHistory((h) => [...h.slice(1), awareness])
      }
    }
    loop()
  }

  const fireEventRef = useRef(fireEvent)
  fireEventRef.current = fireEvent

  const calibrate = useCallback(() => {
    calRef.current = { yaw: 0, pitch: 0, roll: 0, ...lastPoseRef.current }
  }, [])

  const testAlert = useCallback(() => fireEvent('phone', metrics.awareness), [fireEvent, metrics.awareness])

  useEffect(() => () => stop(), [stop])

  return { status, error, metrics, flags, active, history, events, queued, online, start, stop, calibrate, testAlert, streamRef, getPos: () => geoRef.current.pos }
}
