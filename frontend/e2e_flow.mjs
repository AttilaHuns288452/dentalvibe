// E2E flow test: patient signup→book→chat, owner approve→reply→complete
// usage: node /tmp/e2e_flow.mjs <patientEmail>
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(
  fs.readFileSync('/home/attila/Documents/Projects/dentalvibe/frontend/.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')),
)
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const email = process.argv[2]

const { data, error } = await sb.auth.signInWithPassword({ email, password: 'password123' })
if (error) { console.log('0. signin FAIL:', error.message); process.exit(1) }
const uid = data.user.id

const { data: pat } = await sb.from('patients').select('id').eq('user_id', uid).maybeSingle()
if (!pat) { console.log('patient row MISSING'); process.exit(1) }

const { data: svc } = await sb.from('services').select('id, name').order('price').limit(1).single()
const { error: berr } = await sb.from('appointments')
  .insert({ patient_id: pat.id, service_id: svc.id, requested_date: '2026-09-28', notes: 'e2e', status: 'pending' })
console.log('1. patient books:', berr ? 'FAIL ' + berr.message : `ok (${svc.name})`)

const { data: mine } = await sb.from('appointments').select('id, services(name)').eq('patient_id', pat.id)
console.log('2. my appointments:', mine.length)

const { error: cerr } = await sb.from('chat_messages').insert({ patient_id: pat.id, sender: 'patient', body: 'Doc available po?' })
console.log('3. patient chats:', cerr ? 'FAIL ' + cerr.message : 'ok')

await sb.auth.signOut()
const { data: own, error: oerr } = await sb.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
if (oerr) { console.log('4. owner signin:', oerr.message); process.exit(0) }
const { data: oprof } = await sb.from('profiles').select('role').eq('id', own.user.id).maybeSingle()
console.log('4. owner role:', oprof?.role ?? '(no profile row)')

const { data: allAppts } = await sb.from('appointments').select('id').eq('status', 'pending')
console.log('5. owner sees pending:', allAppts.length)

const aid = allAppts[0].id
const { error: aerr } = await sb.from('appointments')
  .update({ status: 'approved', scheduled_at: '2026-09-28T09:00:00' }).eq('id', aid)
console.log('6. approve+assign time:', aerr ? 'FAIL ' + aerr.message : 'ok')

const { error: cerr2 } = await sb.from('chat_messages').insert({ patient_id: pat.id, sender: 'clinic', body: 'Confirmed, 9am.' })
console.log('7. clinic replies:', cerr2 ? 'FAIL ' + cerr2.message : 'ok')

const { error: cperr } = await sb.from('appointments').update({ status: 'completed' }).eq('id', aid)
console.log('8. mark completed:', cperr ? 'FAIL ' + cperr.message : 'ok')
