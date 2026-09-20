// Seed realistic demo data: patients, appointments in every status, chat threads,
// price exceptions. Idempotent-ish: skips if data already present.
// usage: cd frontend && node seed.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
await sb.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })

const PATIENTS = [
  ['Maria Santos', 'maria@dentalvibe.ph', '+63 917 555 0101'],
  ['Juan Dela Cruz', 'juan@dentalvibe.ph', '+63 917 555 0102'],
  ['Andrea Reyes', 'andrea@dentalvibe.ph', '+63 917 555 0103'],
  ['Liza Mendoza', 'liza@dentalvibe.ph', '+63 917 555 0104'],
  ['Carlo Bautista', 'carlo@dentalvibe.ph', '+63 917 555 0105'],
]

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
const svc = (n) => allSvcs.find((s) => s.name.includes(n))
const day = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

// 2. appointments across all statuses
const APPTS = [
  ['Maria Santos', 'Consultation', 'approved', day(0), '09:00', 'Routine checkup'],
  ['Juan Dela Cruz', 'Tooth Filling', 'approved', day(0), '10:30', 'Sensitivity on upper right'],
  ['Andrea Reyes', 'Oral Prophylaxis', 'pending', day(2), null, 'For cleaning po'],
  ['Liza Mendoza', 'Tooth Extraction', 'pending', day(3), null, 'Wisdom tooth hurts'],
  ['Carlo Bautista', 'Braces Consultation', 'pending', day(4), null, ''],
  ['Maria Santos', 'Tooth Filling', 'completed', day(-7), null, ''],
  ['Liza Mendoza', 'Oral Prophylaxis', 'completed', day(-14), null, ''],
  ['Carlo Bautista', 'Tooth Extraction', 'cancelled', day(-3), null, 'Rescheduled'],
]
let apptCount = 0
for (const [pn, sn, status, date, time, notes] of APPTS) {
  const patient_id = byName[pn]
  const service = svc(sn)
  if (!patient_id || !service) { console.log('skip', pn, sn); continue }
  const price = status === 'completed' || status === 'approved' ? service.price : null
  const scheduled = time ? `${date}T${time}:00` : null
  const { count } = await sb.from('appointments').select('*', { count: 'exact', head: true })
    .eq('patient_id', patient_id).eq('requested_date', date).eq('service_id', service.id)
  if (count > 0) { console.log('appt:', pn, sn, date, 'exists'); continue }
  const { error } = await sb.from('appointments')
    .insert({ patient_id, service_id: service.id, requested_date: date, scheduled_at: scheduled, notes, status, price })
  console.log('appt:', `${pn} · ${sn} · ${status} · ${date}`, error ? 'FAIL ' + error.message : 'ok')
  if (!error) apptCount++
}

// 3. price exceptions (the Juan ₱1,000 story + one more)
const EXCEPTIONS = [['Juan Dela Cruz', 'Oral Prophylaxis', 1000], ['Andrea Reyes', 'Tooth Extraction', 1200]]
for (const [pn, sn, price] of EXCEPTIONS) {
  const { error } = await sb.from('service_prices')
    .upsert({ service_id: svc(sn).id, patient_id: byName[pn], price }, { onConflict: 'service_id,patient_id' })
  console.log('exception:', `${pn} · ${sn} = ₱${price}`, error ? 'FAIL ' + error.message : 'ok')
}

// 4. chat threads
const CHATS = [
  ['Maria Santos', 'patient', 'Good morning doc! Confirmation po ng checkup bukas?'],
  ['Maria Santos', 'clinic', 'Confirmed, Maria! 9:00 AM po. See you 👋'],
  ['Juan Dela Cruz', 'patient', 'Doc magkano po ang pasta?'],
  ['Juan Dela Cruz', 'clinic', '₱1,200 po sa filling. May promo kayo ng prophylaxis this month!'],
]
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
console.log(`\nTOTALS — patients: ${pCount}, appointments: ${aCount}, chat messages: ${mCount}, price exceptions: ${eCount}`)
