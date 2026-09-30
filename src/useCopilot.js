import { useEffect, useRef, useState } from 'react'
import { addData } from './dataUsage.js'

// Copiloto de voz "Lucía": avisa por voz cuando salta una alerta y, si se activa la conversación,
// charla con el conductor para mantenerlo despierto. Todo es gratis:
//  - Voz: speechSynthesis del navegador (en el equipo, sin costo).
//  - Oído: reconocimiento de voz del navegador (Chrome/Android; necesita internet y permiso de micrófono).
//  - Búsqueda en internet: API pública de Wikipedia (sin clave).
// No usa un modelo de lenguaje: entiende órdenes concretas (hora, chiste, dato curioso, "busca X").

const NAME = 'Lucía'
const CHAT_WINDOW_MS = 20000 // tras hablar ella, escucha sin necesidad de decir su nombre

const ALERT_PHRASES = {
  drowsy: ['Atención, tienes los ojos cerrados. Abre los ojos y mira el camino.', 'Despierta, por favor. Si tienes sueño, detente en un lugar seguro.'],
  distraction: ['Mira hacia el camino, por favor.', 'Estás mirando fuera de la vía. Vuelve la vista al frente.'],
  tilt: ['Endereza la cabeza. Parece que te estás quedando dormido.', 'Tu cabeza está inclinada. Mantente despierto, por favor.'],
  phone: ['Deja el celular, por favor. Concéntrate en la conducción.', 'Nada de celular mientras conduces.'],
  noface: ['No puedo verte. Revisa que la cámara esté despejada.'],
}
const PROACTIVE = [
  'Noto que estás algo cansado. Vamos a conversar un poco. ¿Quieres un dato curioso?',
  'Oye, ¿cómo vas? Te veo con sueño. Si quieres, te cuento un chiste.',
]
const JOKES = [
  '¿Qué le dice un semáforo a otro? No me mires, que me pongo rojo.',
  '¿Por qué los pájaros vuelan hacia el sur? Porque caminando tardarían demasiado.',
  '¿Qué hace una abeja en el gimnasio? Zum-ba.',
  '¿Cómo se despiden los químicos? Ácido un placer.',
]
const FACTS = [
  'Dato curioso: los pulpos tienen tres corazones y sangre azul.',
  'Dato curioso: la miel no se echa a perder. Se han encontrado tarros comestibles de miles de años.',
  'Dato curioso: un rayo es cinco veces más caliente que la superficie del sol.',
  'Adivinanza: tiene ciudades pero no casas, tiene montañas pero no árboles, y tiene agua pero no peces. ¿Qué es? Un mapa.',
]
const TIPS =
  'Si tienes sueño, lo más seguro es detenerte en un lugar seguro, caminar un poco y tomar agua. Un café tarda unos veinte minutos en hacer efecto, y una siesta corta ayuda más. No sigas conduciendo si se te cierran los ojos.'

const rnd = (a) => a[Math.floor(Math.random() * a.length)]
const norm = (t) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null

function pickVoice() {
  const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => /^es/i.test(v.lang))
  const female = /(helena|sabina|paulina|monica|mónica|laura|elena|lucia|lucía|salome|dalia|elvira|marisol|female|mujer|google espa)/i
  return vs.find((v) => female.test(v.name)) || vs[0] || null
}

async function wiki(q) {
  const term = q.replace(/^(la|el|los|las|un|una|de|del|sobre)\s+/, '').trim()
  if (!term) return null
  const a = await fetch(
    `https://es.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(term)}&srlimit=1&format=json&origin=*`
  )
  const hit = (await a.json()).query?.search?.[0]
  if (!hit) return null
  const b = await fetch(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(hit.title)}`)
  const ext = (await b.json()).extract
  addData('alerts', 8000) // cuenta el consumo aproximado de la consulta
  if (!ext) return null
  // Máximo dos frases, para que no sea un monólogo
  const sentences = ext.replace(/\s*\([^)]*\)/g, '').match(/[^.!?]+[.!?]+/g) || [ext]
  return sentences.slice(0, 2).join(' ').slice(0, 340)
}

export function useCopilot({ settings: s, running, active, metrics }) {
  const [last, setLast] = useState(null) // { who: 'lucia' | 'tu', text }
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const supportedListen = !!SR
  const supportedSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window

  const sRef = useRef(s)
  sRef.current = s
  const speakingRef = useRef(false)
  const untilRef = useRef(0)
  const recRef = useRef(null)
  const wantListenRef = useRef(false)
  const lastAlertAt = useRef(0)
  const lastProactive = useRef(0)
  const prevActive = useRef([])

  const wantTalk = !!(running && s.copilot && s.copilotTalk && supportedListen)

  const say = (text) => {
    if (!supportedSpeak) return
    const synth = window.speechSynthesis
    synth.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'es-ES'
    u.voice = pickVoice()
    if (u.voice) u.lang = u.voice.lang
    u.rate = 1.03
    u.pitch = 1.15 // tono más agudo para una voz femenina
    u.volume = 1
    const done = () => {
      speakingRef.current = false
      untilRef.current = Date.now() + CHAT_WINDOW_MS
      if (wantListenRef.current) startRec()
    }
    u.onstart = () => {
      speakingRef.current = true
      try {
        recRef.current?.abort() // no escucharse a sí misma
      } catch {}
    }
    u.onend = done
    u.onerror = done
    setLast({ who: 'lucia', text })
    synth.speak(u)
  }

  const answer = async (q) => {
    if (!q) return say('Dime, te escucho.')
    if (/gracias/.test(q)) return say('Con gusto. Sigo contigo en el camino.')
    if (/\bhora\b/.test(q)) {
      const d = new Date()
      return say(`Son las ${d.getHours()} y ${String(d.getMinutes()).padStart(2, '0')}.`)
    }
    if (/(fecha|que dia es|dia es hoy)/.test(q))
      return say(`Hoy es ${new Date().toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })}.`)
    if (/(sueno|cansad|dormid|somnolien|bostez|ojos pesados)/.test(q)) return say(TIPS)
    if (/chiste|chistoso|hazme reir/.test(q)) return say(rnd(JOKES))
    if (/(dato|curios|adivinanza|acertijo|trivia|cuentame algo|^(si|dale|claro|ok|bueno|vale)\b)/.test(q) && !/(busca|investiga)/.test(q))
      return say(rnd(FACTS))
    const m = q.match(/^(?:busca|buscar|investiga|dime sobre|cuentame sobre|hablame de|que es|que son|quien es|quien fue|quienes son|donde queda|cual es|cuando)\s+(.+)$/)
    const topic = m ? m[1] : q.length > 3 ? q : ''
    if (!topic) return say('No te entendí. Puedes pedirme la hora, un chiste, un dato curioso, o decir busca y el tema.')
    if (!navigator.onLine) return say('No tengo internet en este momento.')
    try {
      const r = await wiki(topic)
      say(r || `No encontré información sobre ${topic}. Prueba con otra palabra.`)
    } catch {
      say('No pude buscar eso ahora. Revisa la conexión.')
    }
  }

  const handle = (raw) => {
    const t = norm(raw)
    const named = /\blu[cs]ia\b|\blucia\b/.test(t)
    if (!named && Date.now() > untilRef.current) return // solo responde si la nombran o si ella acaba de hablar
    if (speakingRef.current) return
    const q = t.replace(/^(oye|hey|hola|ok|okay)?\s*,?\s*lu[cs]ia\b[,.!?]?\s*/, '').replace(/[¿?¡!.,]/g, '').trim()
    setLast({ who: 'tu', text: raw })
    answer(q)
  }

  const startRec = () => {
    if (!SR || speakingRef.current || !wantListenRef.current) return
    try {
      if (!recRef.current) {
        const r = new SR()
        r.lang = /^es/i.test(navigator.language) ? navigator.language : 'es-ES'
        r.continuous = true
        r.interimResults = false
        r.onresult = (e) => {
          for (let i = e.resultIndex; i < e.results.length; i++)
            if (e.results[i].isFinal) handle(e.results[i][0].transcript)
        }
        r.onstart = () => setListening(true)
        r.onend = () => {
          setListening(false)
          if (wantListenRef.current && !speakingRef.current) setTimeout(startRec, 400)
        }
        r.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            wantListenRef.current = false
            setError('Permite el micrófono para conversar con Lucía.')
          }
        }
        recRef.current = r
      }
      recRef.current.start()
    } catch {
      // ya estaba iniciado
    }
  }

  // Escucha cuando la conversación está activa
  useEffect(() => {
    wantListenRef.current = wantTalk
    if (wantTalk) {
      setError('')
      startRec()
    } else {
      try {
        recRef.current?.abort()
      } catch {}
      setListening(false)
    }
    return () => {
      wantListenRef.current = false
      try {
        recRef.current?.abort()
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantTalk])

  // Avisos por voz cuando salta una alerta nueva
  useEffect(() => {
    const fresh = active.filter((a) => !prevActive.current.includes(a))
    prevActive.current = active
    if (!running || !s.copilot || !fresh.length) return
    if (Date.now() - lastAlertAt.current < 6000) return
    const phrases = ALERT_PHRASES[fresh[0]]
    if (!phrases) return
    lastAlertAt.current = Date.now()
    setTimeout(() => say(rnd(phrases)), 900) // deja sonar primero la sirena
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, running, s.copilot])

  // Si el conductor muestra fatiga, ella inicia la conversación
  useEffect(() => {
    if (!wantTalk || speakingRef.current || active.length) return
    if (metrics.perclos < 0.12 && metrics.awareness > 70) return
    if (Date.now() - lastProactive.current < 180000) return
    lastProactive.current = Date.now()
    say(rnd(PROACTIVE))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics.perclos, metrics.awareness, wantTalk, active])

  // Saludo de prueba
  const test = () => say(`Hola, soy ${NAME}. Estoy contigo en el camino. Si necesitas algo, di mi nombre.`)

  useEffect(() => () => window.speechSynthesis?.cancel(), [])

  return { last, listening, error, supportedListen, supportedSpeak, test }
}
