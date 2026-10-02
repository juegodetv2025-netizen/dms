// CLI de licencias:  npm run admin -- <comando> [args]
import 'dotenv/config'
import { db, licenseConfigured, newCode, normCode, sha256 } from '../server/license.js'

if (!licenseConfigured) {
  console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_KEY en .env')
  process.exit(1)
}

const [cmd, ...rest] = process.argv.slice(2)
const flags = {}
const pos = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[++i]
  else pos.push(rest[i])
}
const days = (n) => new Date(Date.now() + Number(n) * 86_400_000).toISOString()
const die = (m) => (console.error(m), process.exit(1))
const ok = ({ data, error }) => (error ? die(error.message) : data)

const commands = {
  async 'customer:add'() {
    const [name] = pos
    if (!name) die('Uso: customer:add "Nombre" --days 365 --devices 5')
    const rows = ok(
      await db
        .from('customers')
        .insert({ name, expires_at: days(flags.days || 365), max_devices: Number(flags.devices || 1) })
        .select()
    )
    console.log('Cliente creado:', rows[0])
  },
  async 'customer:list'() {
    const customers = ok(await db.from('customers').select('*').order('created_at'))
    const devs = ok(await db.from('devices').select('customer_id').eq('status', 'active'))
    for (const c of customers) {
      const n = devs.filter((d) => d.customer_id === c.id).length
      console.log(`${c.id}  ${c.name}  [${c.status}]  vence ${c.expires_at.slice(0, 10)}  vehículos ${n}/${c.max_devices}`)
    }
  },
  async 'customer:suspend'() {
    ok(await db.from('customers').update({ status: 'suspended' }).eq('id', pos[0]))
    console.log('Suspendido. Sus móviles pierden acceso en la próxima verificación.')
  },
  async 'customer:activate'() {
    ok(await db.from('customers').update({ status: 'active' }).eq('id', pos[0]))
    console.log('Reactivado.')
  },
  async 'customer:extend'() {
    const [c] = ok(await db.from('customers').select('expires_at').eq('id', pos[0]))
    if (!c) die('Cliente no encontrado')
    const base = Math.max(Date.now(), new Date(c.expires_at).getTime())
    const next = new Date(base + Number(flags.days || 365) * 86_400_000).toISOString()
    ok(await db.from('customers').update({ expires_at: next, status: 'active' }).eq('id', pos[0]))
    console.log('Nuevo vencimiento:', next.slice(0, 10))
  },
  async 'code:new'() {
    const [customerId] = pos
    if (!customerId) die('Uso: code:new <customerId> --label "ABC-123" --hours 72')
    const code = newCode()
    ok(
      await db.from('activation_codes').insert({
        customer_id: customerId,
        code_hash: sha256(normCode(code)),
        label: flags.label || null,
        expires_at: new Date(Date.now() + Number(flags.hours || 72) * 3_600_000).toISOString(),
      })
    )
    console.log(`Código de activación: ${code}   (vehículo: ${flags.label || '-'}, un solo uso)`)
  },
  async 'device:list'() {
    const devs = ok(await db.from('devices').select('*').eq('customer_id', pos[0]).order('created_at'))
    for (const d of devs) console.log(`${d.id}  ${d.label || '-'}  [${d.status}]  visto ${d.last_seen || 'nunca'}`)
  },
  async 'device:revoke'() {
    ok(await db.from('devices').update({ status: 'revoked', revoked_at: new Date().toISOString() }).eq('id', pos[0]))
    console.log('Dispositivo revocado.')
  },
}

if (!commands[cmd]) {
  console.log('Comandos:\n  ' + Object.keys(commands).join('\n  '))
  process.exit(cmd ? 1 : 0)
}
await commands[cmd]()
