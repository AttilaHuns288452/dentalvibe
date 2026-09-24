// Security evidence — proves S1/S2/S3/S5/S6 enforcement end-to-end with real sessions.
// Usage: SB_SECRET=... node security_evidence.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const KEY = fs.readFileSync('.env.local', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim()
const svc = createClient(URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const ok = (id, label, pass, detail = '') => console.log(`${pass ? 'PASS' : 'FAIL'} | ${id} ${label}${detail ? ' :: ' + detail : ''}`)
const mk = async (email, pw = 'password123') => {
  const c = createClient(URL, KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: pw })
  if (error) throw new Error(email + ': ' + error.message)
  return c
}

// ---- S1: deactivated dentist loses ALL staff power (fn_my_role returns null) ----
{
  // temp dentist user (cleaned up after)
  const email = 'evidence-dentist@dentalvibe.ph'
  const { data: found } = await svc.from('dentists').select('id').eq('email', email).limit(1)
  for (const f of found ?? []) await svc.from('dentists').delete().eq('id', f.id)
  const { data: existing } = await svc.auth.admin.listUsers()
  for (const u of existing?.users ?? []) if (u.email === email) await svc.auth.admin.deleteUser(u.id)
  const { data: nu, error: nuErr } = await svc.auth.admin.createUser({ email, password: 'password123', email_confirm: true })
  if (nuErr) { console.log('SKIP S1 — admin user create failed:', nuErr.message) } else {
    await svc.from('dentists').insert({ full_name: 'Evidence Dentist', email, role: 'doctor', active: true })
    const doc = await mk(email)
    const mar = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
    const { error: whileActive } = await doc.from('appointments').update({ clinical_note: 'probe' }).eq('patient_id', mar).limit(1)
    ok('S1a', 'active dentist CAN write (control)', !whileActive || !/denied|policy|role|staff/i.test(whileActive.message), whileActive?.message ?? 'write ok')

    await svc.from('dentists').update({ active: false }).eq('email', email)
    const doc2 = await mk(email) // fresh session AFTER deactivation
    const probe = await doc2.from('appointments').update({ clinical_note: 'probe2' }).eq('patient_id', mar).select()
    const probeSel = await doc2.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1) // SOMEONE ELSE's row (own row is legitimately readable)
    const deniedWrite = (probe.error != null) || (probe.data ?? []).length === 0
    const deniedRead = (probeSel.error != null) || (probeSel.data ?? []).length === 0
    ok('S1b', 'deactivated dentist write DENIED', deniedWrite, probe.error?.message ?? `${(probe.data ?? []).length} rows changed`)
    ok('S1c', 'deactivated dentist staff-read DENIED', deniedRead, probeSel.error?.message ?? `${(probeSel.data ?? []).length} rows`)

    // cleanup
    await svc.from('dentists').delete().eq('email', email)
    await svc.auth.admin.deleteUser(nu.user.id)
  }
}

// ---- S2: doctor CANNOT touch transactions (income/expense) ----
{
  const doc = await mk('doctor@dentalvibe.ph')
  const ins = await doc.from('transactions').insert({ type: 'income', category: 'probe', amount: 999, patient_name: 'probe', description: 'probe' }).select()
  const upd = await doc.from('transactions').update({ amount: 1 }).eq('description', 'probe').select()
  ok('S2', 'doctor write to transactions DENIED', (ins.error != null || !(ins.data ?? []).length) && (upd.error != null || !(upd.data ?? []).length),
    ins.error?.message ?? upd.error?.message ?? 'rows written!')
  const own = await mk('owner@dentalvibe.ph')
  const insOwn = await own.from('transactions').insert({ type: 'expense', category: 'probe', amount: 10, patient_name: 'probe', description: 'probe-owner' }).select()
  ok('S2b', 'owner write to transactions ALLOWED (control)', !insOwn.error && (insOwn.data ?? []).length === 1, insOwn.error?.message ?? 'ok')
  if ((insOwn.data ?? []).length) await svc.from('transactions').delete().eq('description', 'probe-owner')
  await svc.from('transactions').delete().eq('description', 'probe')
}

// ---- S3: doctor CANNOT manage dentists ----
{
  const doc = await mk('doctor@dentalvibe.ph')
  const ins = await doc.from('dentists').insert({ full_name: 'Rogue', email: 'rogue@x.ph', role: 'doctor' }).select()
  ok('S3', 'doctor insert dentist DENIED', ins.error != null || !(ins.data ?? []).length, ins.error?.message ?? 'inserted!')
  if ((ins.data ?? []).length) await svc.from('dentists').delete().eq('email', 'rogue@x.ph')
  const own = await mk('owner@dentalvibe.ph')
  const insOwn = await own.from('dentists').insert({ full_name: 'Evidence Tmp', email: 'evidence-tmp@x.ph', role: 'doctor' }).select()
  ok('S3b', 'owner insert dentist ALLOWED (control)', !insOwn.error, insOwn.error?.message ?? 'ok')
  if ((insOwn.data ?? []).length) await svc.from('dentists').delete().eq('email', 'evidence-tmp@x.ph')
}

// ---- S5: negative price + zero duration rejected at the DB ----
{
  const bad1 = await svc.from('services').insert({ name: 'Evil Service', price: -500, duration_minutes: 30 }).select()
  ok('S5a', 'negative service price REJECTED', bad1.error != null, bad1.error?.message ?? 'ACCEPTED!')
  if ((bad1.data ?? []).length) await svc.from('services').delete().eq('name', 'Evil Service')
  const bad2 = await svc.from('services').insert({ name: 'Evil Service 2', price: 0, duration_minutes: 30 }).select()
  ok('S5b', 'zero service price REJECTED', bad2.error != null, bad2.error?.message ?? 'ACCEPTED!')
  if ((bad2.data ?? []).length) await svc.from('services').delete().eq('name', 'Evil Service 2')
  const mar = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
  const s = (await svc.from('services').select('id, price').limit(1)).data[0]
  const bad3 = await svc.from('appointments').insert({ patient_id: mar, service_id: s.id, service_ids: [s.id], requested_date: '2033-01-05', scheduled_at: '2033-01-05T02:00:00Z', duration_minutes: 0, price: s.price, status: 'pending' }).select()
  ok('S5c', 'zero-duration appointment REJECTED', bad3.error != null, bad3.error?.message ?? 'ACCEPTED!')
  if ((bad3.data ?? []).length) await svc.from('appointments').delete().eq('id', bad3.data[0].id)
  const bad4 = await svc.from('appointments').insert({ patient_id: mar, service_id: s.id, service_ids: [s.id], requested_date: '2033-01-06', scheduled_at: '2033-01-06T02:00:00Z', duration_minutes: 30, price: -5, status: 'pending' }).select()
  ok('S5d', 'negative appointment price REJECTED', bad4.error != null, bad4.error?.message ?? 'ACCEPTED!')
  if ((bad4.data ?? []).length) await svc.from('appointments').delete().eq('id', bad4.data[0].id)
}

// ---- S6: chat body > 4000 chars rejected ----
{
  const mar = await mk('maria@dentalvibe.ph')
  const pid = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
  const big = await mar.from('chat_messages').insert({ patient_id: pid, sender: 'patient', body: 'x'.repeat(4001) }).select()
  ok('S6', '4001-char chat body REJECTED', big.error != null, big.error?.message ?? 'ACCEPTED!')
  if ((big.data ?? []).length) await svc.from('chat_messages').delete().eq('id', big.data[0].id)
  const fine = await mar.from('chat_messages').insert({ patient_id: pid, sender: 'patient', body: 'evidence ok' }).select()
  ok('S6b', 'normal chat body ACCEPTED (control)', !fine.error, fine.error?.message ?? 'ok')
  if ((fine.data ?? []).length) await svc.from('chat_messages').delete().eq('id', fine.data[0].id)
}
console.log('security_evidence done')
