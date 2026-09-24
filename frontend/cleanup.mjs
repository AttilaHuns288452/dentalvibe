// Cleanup: remove ALL non-seed rows. The seed row map below is the single source of truth —
// deleting by name/shape guesses is what ate seed data 3x before. If the seed grows, update THIS map.
import { createClient } from '@supabase/supabase-js'

const svc = createClient('https://wfmtkmfevdqbhtpqamic.supabase.co', process.env.SB_SECRET, { auth: { persistSession: false } })

// exact curated demo rows: requested_date | patient | status
const SEED_ROWS = new Set([
  '2026-09-01|Carlo Bautista|cancelled',
  '2026-09-02|Andrea Reyes|completed',
  '2026-09-07|Liza Mendoza|completed',
  '2026-09-08|Juan Dela Cruz|completed',
  '2026-09-12|Maria Santos|completed',
  '2026-09-15|Carlo Bautista|completed',
  '2026-09-22|Juan Dela Cruz|completed',
  '2026-09-22|Maria Santos|completed',
  '2026-09-23|Maria Santos|completed',
  '2026-09-24|Maria Santos|pending',
  '2026-09-24|Juan Dela Cruz|completed',
  '2026-10-05|Andrea Reyes|pending',
  '2026-10-06|Liza Mendoza|pending',
  '2026-10-07|Carlo Bautista|approved',
  '2026-10-08|Andrea Reyes|pending',
  '2026-10-09|Maria Santos|approved',
  '2026-10-26|Maria Santos|pending',
])
// seed services: name must exist exactly here or it is test junk
const SEED_SERVICES = new Set(['Consultation', 'Oral Prophylaxis', 'Tooth Filling', 'Tooth Extraction', 'Braces Consultation', 'Fluoride Treatment', 'Whitening'])
const SEED_PATIENTS = new Set(['Maria Santos', 'Juan Dela Cruz', 'Andrea Reyes', 'Liza Mendoza', 'Carlo Bautista'])

const { data: rows } = await svc.from('appointments')
  .select('id, requested_date, status, patient_id, patients(full_name), services(name), service_ids')
  .order('requested_date')
let removed = 0
for (const r of rows ?? []) {
  const key = `${r.requested_date}|${r.patients?.full_name}|${r.status}`
  if (!SEED_ROWS.has(key) || !r.services || !SEED_SERVICES.has(r.services.name) || (r.service_ids ?? []).length > 1) {
    await svc.from('payment_proofs').delete().eq('appointment_id', r.id)
    await svc.from('ehr_attachments').delete().eq('patient_id', r.patient_id).eq('note', 'test')
    await svc.from('appointments').delete().eq('id', r.id)
    removed++
    console.log('appointment removed:', key, '|', r.services?.name)
  }
}

for (const [tbl, col, set] of [
  ['services', 'name', SEED_SERVICES],
  ['patients', 'full_name', SEED_PATIENTS],
]) {
  const { data: all } = await svc.from(tbl).select('id, ' + col)
  for (const r of all ?? []) {
    if (!set.has(r[col])) {
      if (tbl === 'patients') await svc.from('ehr_attachments').delete().eq('patient_id', r.id)
      await svc.from(tbl).delete().eq('id', r.id)
      console.log(tbl, 'removed:', r[col])
    }
  }
}
// stray test users (never seed-auth rows: seed patients' auth users stay)
const { data: profiles } = await svc.from('profiles').select('id, full_name')
for (const p of profiles ?? []) {
  if (!SEED_PATIENTS.has(p.full_name) && p.full_name !== 'Clinic Owner' && p.full_name !== 'Dr. Cruz') {
    await svc.from('notifications').delete().eq('user_id', p.id)
  }
}

const { count } = await svc.from('appointments').select('*', { count: 'exact', head: true })
console.log(`cleaned ${removed} appointment(s); state = ${count} appointments (seed map = ${SEED_ROWS.size})`)
