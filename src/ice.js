// Configuración WebRTC compartida entre vehículo y coordinador.
// STUN público sirve en redes simples; en 4G suele hacer falta un servidor TURN
// (pégalo como JSON en Ajustes: [{"urls":"turn:host:443","username":"u","credential":"p"}]).
export const DEFAULT_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export function parseIce(txt) {
  if (!txt || !txt.trim()) return DEFAULT_ICE
  try {
    const j = JSON.parse(txt)
    return Array.isArray(j) && j.length ? j : DEFAULT_ICE
  } catch {
    return DEFAULT_ICE
  }
}

const clean = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '')
export const peerIdFor = (fleet, vehicle) => `dms-${clean(fleet)}-${clean(vehicle)}`
