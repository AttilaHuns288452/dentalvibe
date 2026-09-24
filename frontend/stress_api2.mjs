import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const ANON = fs.readFileSync(new globalThis.URL('./.env.local', import.meta.url), 'utf8').match(/ANON_KEY=(.*)/)[1].trim()
const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const svc = createClient(URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const as = async (email, pw) => { const c = createClient(URL, ANON); await c.auth.signInWithPassword({ email, password: pw }); return c }

// 1. self-promote (last run's result was a Promise bug — real answer needed)
const { data: users } = await svc.auth.admin.listUsers()
let uid = users.users.find(u => u.email === 'stress.c@test.ph')?.id
if (!uid) { const { data: u } = await svc.auth.admin.createUser({ email: 'stress.c@test.ph', password: 'Stress123', email_confirm: true, user_metadata: { full_name: 'Stress C' } }); uid = u.user.id }
const C = await as('stress.c@test.ph', 'Stress123')
const r1 = await C.from('profiles').update({ role: 'owner' }).eq('id', uid)
const roleNow = (await C.from('profiles').select('role').eq('id', uid).limit(1)).data?.[0]?.role
console.log('self-promote:', roleNow === 'owner' ? 'BREAK — patient became OWNER' : 'ok — blocked', '| err:', r1.error?.message ?? 'none', '| role:', roleNow)

// 2. medical_note readability (real value, real patient)
const maria = await as('maria@dentalvibe.ph', 'password123')
const mn = (await maria.from('patients').select('medical_note, full_name').limit(1)).data?.[0]
console.log('medical_note via patient session:', JSON.stringify(mn), mn?.medical_note ? 'BREAK — internal note exposed' : 'ok — empty/null (but column readable)')

// 3. ehr_attachments INSERT as doctor (p110 Add Attachment must work for staff)
const doc = await as('doctor@dentalvibe.ph', 'password123')
const pidM = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
const r3 = await doc.from('ehr_attachments').insert({ patient_id: pidM, kind: 'X-ray', file_name: 'probe.png' })
console.log('doctor INSERT ehr_attachment:', r3.error ? 'BLOCKED (' + r3.error.message + ')' : 'ok — accepted')
await svc.from('ehr_attachments').delete().eq('file_name', 'probe.png')

// 4. owner INSERT ehr_attachment (contrast)
const own = await as('owner@dentalvibe.ph', 'password123')
const r4 = await own.from('ehr_attachments').insert({ patient_id: pidM, kind: 'X-ray', file_name: 'probe2.png' })
console.log('owner INSERT ehr_attachment:', r4.error ? 'BLOCKED (' + r4.error.message + ')' : 'ok — accepted')
await svc.from('ehr_attachments').delete().eq('file_name', 'probe2.png')

// 5. doctor UPDATE patient_code / medical_note (staff edit surface)
const r5 = await doc.from('patients').update({ medical_note: 'note by doc' }).eq('id', pidM)
console.log('doctor UPDATE medical_note:', r5.error ? 'blocked (' + r5.error.message + ')' : 'ok — accepted (staff edit)')

// 6. cleanup stress.c
await svc.from('appointments').delete().is('patient_id', null)
const pidC = (await svc.from('patients').select('id').eq('user_id', uid).limit(1)).data?.[0]?.id
if (pidC) await svc.from('patients').delete().eq('id', pidC)
await svc.from('profiles').delete().eq('id', uid)
await svc.auth.admin.deleteUser(uid).catch(() => {})
console.log('[cleaned]')
