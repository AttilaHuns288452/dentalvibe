// Seed demo data FROM seed_map.mjs (single source of truth — cleanup.mjs protects the same rows).
// Idempotent: skips rows that already exist. Exact service names (no fuzzy matching).
// usage: cd frontend && node seed.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import { PATIENTS, SEED_APPTS, EXCEPTIONS, CHATS } from './seed_map.mjs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
await sb.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })

// 1. patients
for (const [name, email, phone] of PATIENTS) {
  const { data: found } = await sb.from('patients').select('id').eq('email', email).maybeSingle()
  if (!found) {
    const { error } = await sb.from('patients').insert({ full_name: name, email, phone })
    console.log('patient:', name, error ? 'FAIL ' + error.message : 'ok')
  } else console.log('patient:', name, 'exists')
}

const { data: allPats } = await sb.from('patients').select('id, full_name').order('full_name')
const byName = Object.fromEntries(allPats.map((p) => [p.full_name, p.id]))
const { data: allSvcs } = await sb.from('services').select('id, name, price').order('price')
const svc = (n) => allSvcs.find((s) => s.name === n) // exact — 'Consultation' must not match 'Braces Consultation'

// 2. appointments from the map
let apptCount = 0
for (const [pn, sn, status, date, notes] of SEED_APPTS) {
  const patient_id = byName[pn]
  const service = svc(sn)
  if (!patient_id || !service) { console.log('skip (missing):', pn, sn); continue }
  const price = status === 'completed' || status === 'approved' ? service.price : null
  const { count } = await sb.from('appointments').select('*', { count: 'exact', head: true })
    .eq('patient_id', patient_id).eq('requested_date', date).eq('service_id', service.id)
  if (count > 0) { console.log('appt:', pn, sn, date, 'exists'); continue }
  const { error } = await sb.from('appointments')
    .insert({ patient_id, service_id: service.id, service_ids: [service.id], requested_date: date, notes, status, price, duration_minutes: service.duration_minutes ?? 30 })
  console.log('appt:', `${pn} · ${sn} · ${status} · ${date}`, error ? 'FAIL ' + error.message : 'ok')
  if (!error) apptCount++
}

// 3. price exceptions
for (const [pn, sn, price] of EXCEPTIONS) {
  const s = svc(sn)
  if (!s || !byName[pn]) continue
  const { error } = await sb.from('service_prices')
    .upsert({ service_id: s.id, patient_id: byName[pn], price }, { onConflict: 'service_id,patient_id' })
  console.log('exception:', `${pn} · ${sn} = ₱${price}`, error ? 'FAIL ' + error.message : 'ok')
}

// 4. chat threads
for (const [pn, sender, body] of CHATS) {
  const patient_id = byName[pn]
  const { data: existing } = await sb.from('chat_messages').select('id').eq('patient_id', patient_id).eq('body', body).maybeSingle()
  if (existing) { console.log('chat:', 'exists'); continue }
  const { error } = await sb.from('chat_messages').insert({ patient_id, sender, body })
  console.log('chat:', `${pn} (${sender})`, error ? 'FAIL ' + error.message : 'ok')
}

// 5. summary
const { count: pCount } = await sb.from('patients').select('*', { count: 'exact', head: true })
const { count: aCount } = await sb.from('appointments').select('*', { count: 'exact', head: true })
const { count: mCount } = await sb.from('chat_messages').select('*', { count: 'exact', head: true })
const { count: eCount } = await sb.from('service_prices').select('*', { count: 'exact', head: true })
console.log(`\nTOTALS — patients: ${pCount}, appointments: ${aCount} (map: ${SEED_APPTS.length}, created ${apptCount}), chat: ${mCount}, price exceptions: ${eCount}`)
