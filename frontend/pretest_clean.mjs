// Pre-test hygiene: clear each suite's OWN test patients' future bookings (+ proofs).
// Runs at suite start when SB_SECRET is set. Test runs accumulate rows across runs;
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
