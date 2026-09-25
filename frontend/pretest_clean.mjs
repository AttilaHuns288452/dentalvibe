// Pre-test hygiene: clear each suite's OWN test patients' future bookings (+ proofs).
// Runs at suite start when SB_SECRET is set. Test runs accumulate rows across rows;
// the DB correctly refuses overlapping slots — stale rows make suites flap.
import { createClient } from '@supabase/supabase-js'

export async function cleanTestFuture(names) {
  if (!process.env.SB_SECRET) return
  const svc = createClient('https://wfmtkmfevdqbhtpqamic.supabase.co', process.env.SB_SECRET, { auth: { persistSession: false } })
  const today = new Date().toISOString().slice(0, 10)
  const { data: ps } = await svc.from('patients').select('id').in('full_name', names)
  const ids = (ps ?? []).map((p) => p.id)
  if (!ids.length) return
  const { data: rows } = await svc.from('appointments').select('id').in('patient_id', ids).gte('requested_date', today)
  for (const r of rows ?? []) await svc.from('payment_proofs').delete().eq('appointment_id', r.id) // proofs FK cascades anyway
  await svc.from('appointments').delete().in('patient_id', ids).gte('requested_date', today)
  console.log('pretest-clean:', names.join(', '), '-', (rows ?? []).length, 'future row(s) removed')
}

export async function cleanTestPatients() {
  if (!process.env.SB_SECRET) return
  const svc = createClient('https://wfmtkmfevdqbhtpqamic.supabase.co', process.env.SB_SECRET, { auth: { persistSession: false } })
  const testNames = ['Prod Patient', 'QA Final', 'Demo Patient', 'Journey Tester', 'Stress Patient']
  const { data: ps } = await svc.from('patients').select('id').in('full_name', testNames)
  let removed = 0
  for (const p of ps ?? []) {
    await svc.from('ehr_attachments').delete().eq('patient_id', p.id)
    await svc.from('chat_messages').delete().eq('patient_id', p.id)
    await svc.from('payment_proofs').delete().in('appointment_id', (await svc.from('appointments').select('id').eq('patient_id', p.id)).data?.map((a) => a.id) ?? [])
    await svc.from('appointments').delete().eq('patient_id', p.id)
    await svc.from('patients').delete().eq('id', p.id)
    removed++
  }
  if (removed) console.log('pretest-clean: removed', removed, 'test patient(s)')
}
