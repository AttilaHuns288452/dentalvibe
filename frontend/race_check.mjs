// S7 runnable check — concurrent overlapping payments must NOT both verify.
// Usage: node race_check.mjs   (needs SB_SECRET in env; uses two real patient sessions)
// Prints "RACE OPEN (n/5 rounds double-verified)" before the advisory lock, "LOCKED (0/5)" after.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const KEY = fs.readFileSync('.env.local', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim()
const svc = createClient(URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const mk = async (email) => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } })
  await c.auth.signInWithPassword({ email, password: 'password123' })
  return c
}
const maria = await mk('maria@dentalvibe.ph')
const juan = await mk('juan@dentalvibe.ph')
const pids = {}
for (const [k, n] of [['maria', 'Maria Santos'], ['juan', 'Juan Dela Cruz']]) {
  pids[k] = (await svc.from('patients').select('id').eq('full_name', n).limit(1)).data[0].id
}
const big = (await svc.from('services').select('id, name, price, duration_minutes').order('duration_minutes', { ascending: false }).limit(1)).data[0]
const eff = async (pid) => (await svc.from('service_prices').select('price').eq('patient_id', pid).eq('service_id', big.id).limit(1)).data?.[0]?.price ?? big.price

let double = 0
const ROUNDS = 5
for (let r = 0; r < ROUNDS; r++) {
  const D = `2032-0${(r % 8) + 1}-15` // distinct future day per round
  const book = async (pid, hh) => {
    const { data } = await svc.from('appointments').insert({
      patient_id: pid, service_id: big.id, service_ids: [big.id], requested_date: D,
      scheduled_at: `${D}T${hh}:00Z`, duration_minutes: big.duration_minutes, price: await eff(pid), status: 'pending',
    }).select('id')
    return data[0].id
  }
  const A = await book(pids.maria, '02:00')   // 10:00–11:00 PH (60 min)
  const B = await book(pids.juan, '02:30')    // 10:30 start — overlaps A's interval
  // fire BOTH payment creates concurrently — the race window
  // (slot reservation happens under the per-day advisory lock inside create)
  const [pa, pb] = await Promise.allSettled([
    maria.functions.invoke('paymongo-create', { body: { appointment_id: A } }),
    juan.functions.invoke('paymongo-create', { body: { appointment_id: B } }),
  ])
  const okA = pa.status === 'fulfilled' && !pa.value.error
  const okB = pb.status === 'fulfilled' && !pb.value.error
  if (okA && okB) double++
  console.log(`round ${r + 1}: A=${okA ? 'verified' : 'blocked'} B=${okB ? 'verified' : 'blocked'}${okA && okB ? '  <-- DOUBLE-VERIFIED' : ''}`)
  for (const id of [A, B]) { await svc.from('payments').delete().eq('appointment_id', id); await svc.from('appointments').delete().eq('id', id) }
}

console.log(double > 0
  ? `RACE OPEN (${double}/${ROUNDS} rounds double-verified) — lock NOT in place`
  : `LOCKED (0/${ROUNDS} double-verified — exactly one pay wins every round)`)
process.exit(double > 0 ? 1 : 0)
