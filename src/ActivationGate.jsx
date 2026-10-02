import { useState } from 'react'
import { useLicense } from './license.js'

const REASONS = {
  suspended: 'Tu licencia está suspendida. Contacta a tu proveedor.',
  expired: 'Tu licencia venció. Contacta a tu proveedor.',
  revoked: 'Este dispositivo fue desautorizado. Solicita un nuevo código de activación.',
  offline_expired: 'Hace más de 72 h sin verificar la licencia. Conéctate a internet.',
}

// El bloqueo solo se activa al compilar con VITE_REQUIRE_LICENSE=1 (y VITE_API_BASE apuntando al servidor).
// Así un despliegue sin servidor de licencias no queda bloqueado.
const REQUIRED = import.meta.env.VITE_REQUIRE_LICENSE === '1'

export default function ActivationGate({ children }) {
  return REQUIRED ? <Gate>{children}</Gate> : children
}

function Gate({ children }) {
  const { allowed, info, activate } = useLicense()
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (allowed) return children

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await activate(code)
    } catch (x) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#070b14', color: '#e5e7eb', padding: 16 }}>
      <form onSubmit={submit} style={{ width: 'min(380px,100%)', display: 'grid', gap: 14 }}>
        <h1 style={{ margin: 0, fontSize: 22 }}>Activar DMS</h1>
        <p style={{ margin: 0, opacity: 0.75, fontSize: 14 }}>
          {REASONS[info?.reason] || info?.error || 'Ingresa el código de activación de este vehículo.'}
        </p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          autoCapitalize="characters"
          autoComplete="off"
          maxLength={9}
          style={{ padding: 14, fontSize: 22, letterSpacing: 4, textAlign: 'center', borderRadius: 10, border: '1px solid #334155', background: '#0f172a', color: 'inherit' }}
        />
        {err && <div style={{ color: '#f87171', fontSize: 14 }}>{err}</div>}
        <button
          disabled={busy || code.replace(/[^A-Z0-9]/g, '').length < 8}
          style={{ padding: 14, fontSize: 16, borderRadius: 10, border: 0, background: '#2563eb', color: '#fff', opacity: busy ? 0.6 : 1 }}
        >
          {busy ? 'Verificando…' : 'Activar'}
        </button>
      </form>
    </div>
  )
}
