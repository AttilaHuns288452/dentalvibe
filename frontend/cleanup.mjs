// Cleanup: remove every row that is NOT in seed_map.mjs (the single source of truth).
// Matching is exact — date | patient | service | status. Seed rows are NEVER deleted.
// Usage: SB_SECRET=... node cleanup.mjs
import { createClient } from '@supabase/supabase-js'
import { PATIENTS, SEED_SERVICES, SEED_APPTS, EXCEPTIONS, CHATS, apptKey } from './seed_map.mjs'

const svc = createClient('https://wfmtkmfevdqbhtpqamic.supabase.co', process.env.SB_SECRET, { auth: { persistSession: false } })
const SEED_ROWS = new Set(SEED_APPTS.map(([p, s, st, d]) => apptKey(d, p, s, st)))
const SEED_SVC = new Set(SEED_SERVICES)
const SEED_PAT = new Set(PATIENTS.map(([n]) => n))

const { data: rows } = await svc.from('appointments')
  .select('id, requested_date, status, patient_id, patients(full_name), services(name)')
  .order('requested_date')
let removed = 0
for (const r of rows ?? []) {
  const key = apptKey(r.requested_date, r.patients?.full_name, r.services?.name, r.status)
  if (!SEED_ROWS.has(key)) {
    await svc.from('payment_proofs').delete().eq('appointment_id', r.id)
    await svc.from('appointments').delete().eq('id', r.id)
    removed++
    console.log('appointment removed:', key)
  }
}

for (const [tbl, col, set] of [['services', 'name', SEED_SVC], ['patients', 'full_name', SEED_PAT]]) {
  const { data: all } = await svc.from(tbl).select('id, ' + col)
  for (const r of all ?? []) {
    if (!set.has(r[col])) {
      if (tbl === 'patients') await svc.from('ehr_attachments').delete().eq('patient_id', r.id)
      await svc.from(tbl).delete().eq('id', r.id)
      console.log(tbl, 'removed:', r[col])
    }
  }
}

// chat + price exceptions are map-scoped too (tests accumulate both)
const SEED_BODIES = new Set(CHATS.map(([, , b]) => b))
const { data: msgs } = await svc.from('chat_messages').select('id, body')
for (const m of msgs ?? []) if (!SEED_BODIES.has(m.body)) { await svc.from('chat_messages').delete().eq('id', m.id); removed++ }
const SEED_EXC = new Set(EXCEPTIONS.map(([p, s2, pr]) => `${p}|${s2}|${pr}`))
const { data: excs } = await svc.from('service_prices').select('service_id, patient_id, price, services(name), patients(full_name)')
for (const e of excs ?? []) {
  const k = `${e.patients?.full_name}|${e.services?.name}|${e.price}`
  if (!SEED_EXC.has(k)) { await svc.from('service_prices').delete().eq('service_id', e.service_id).eq('patient_id', e.patient_id); removed++ }
}

const { count } = await svc.from('appointments').select('*', { count: 'exact', head: true })
console.log(`cleaned ${removed} appointment(s); state = ${count} (map = ${SEED_ROWS.size})`)
if (count !== SEED_ROWS.size) {
  console.log('NOTE: row count differs from map — some map rows may be missing (run seed.mjs), or dupes exist')
}
