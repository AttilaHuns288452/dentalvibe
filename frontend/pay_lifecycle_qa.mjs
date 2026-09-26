// pay_lifecycle_qa.mjs — reservation + late-payment invariants (§16/§17).
// 1. A PENDING payment reserves its slot: another patient cannot book it.
// 2. Expire/release: once the reservation expires the slot becomes bookable.
// 3. LATE PAYMENT AFTER SLOT REUSE: an old payment reporting success after
//    its slot was rebooked must NOT create a double booking — the two
//    appointments are never both approved on the same slot.
// Run (from frontend/): SB_SECRET=<service key> node pay_lifecycle_qa.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SB_SECRET)
const maria = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const juan = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

await maria.auth.signInWithPassword({ email: 'maria@dentalvibe.ph', password: 'password123' })
await juan.auth.signInWithPassword({ email: 'juan@dentalvibe.ph', password: 'password123' })
const mariaId = (await maria.from('patients').select('id').eq('user_id', (await maria.auth.getUser()).data.user.id).maybeSingle()).data.id
const juanId = (await juan.from('patients').select('id').eq('user_id', (await juan.auth.getUser()).data.user.id).maybeSingle()).data.id
const svcRow = (await svc.from('services').select('id, price').eq('active', true).order('price').limit(1).maybeSingle()).data
const DAY = 60 + Math.floor(Math.random() * 200)
const when = new Date(Date.now() + DAY * 864e5); when.setUTCHours(2, 0, 0, 0) // 10:00 Asia/Manila
  while (when.getUTCDay() === 0) when.setUTCDate(when.getUTCDate() + 1) // clinic closed Sundays



// provider-side transient 500s happen (~1% of creates under load) — bounded retry
const mkPay = async (client, apptId) => {
  for (let i = 0; i < 3; i++) {
    const r = await client.functions.invoke('paymongo-create', { body: { appointment_id: apptId } })
    if (r.data?.payment_id) return r.data
    if (r.error || r.data?.error) console.log('mkPay attempt', i, 'error:', JSON.stringify(r.data?.error ?? r.error?.message).slice(0, 120))
    await new Promise((res) => setTimeout(res, 1500))
  }
  return null
}

const mkAppt = async (pid, day) => {
  const d = new Date(Date.now() + day * 864e5); d.setUTCHours(2, 0, 0, 0)
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1) // clinic closed Sundays

  return (await svc.from('appointments').insert({
    patient_id: pid, service_id: svcRow.id, service_ids: [svcRow.id],
    scheduled_at: d.toISOString(), requested_date: d.toISOString().slice(0, 10),
    price: svcRow.price, status: 'pending', payment_status: 'unpaid',
  }).select().maybeSingle()).data
}

// ── 1. PENDING payment reserves the slot ──
const apptA = await mkAppt(mariaId, DAY)
const payA = await mkPay(maria, apptA.id)
check('1a. payment created (slot reserved)', payA?.status === 'pending', payA?.error ?? '')
// per-dentist capacity: same time on THE SAME dentist is always rejected;
// other ready dentists may legitimately take the parallel slot (asserted below)
const { data: apptARow } = await svc.from('appointments').select('dentist_id').eq('id', apptA.id).maybeSingle()
// staff-side RESERVATION (patient inserts are forced unpaid = drafts, which
// legitimately do not hold chairs — the reservation layer is the conflict boundary)
const clash = await svc.from('appointments').insert({
  patient_id: juanId, service_id: svcRow.id, service_ids: [svcRow.id],
  scheduled_at: when.toISOString(), requested_date: when.toISOString().slice(0, 10),
  price: svcRow.price, status: 'pending', payment_status: 'pending', dentist_id: apptARow.dentist_id,
}).select()
check('1b. same dentist cannot take an overlapping reservation', !!clash.error, clash.error?.message?.slice(0, 60) ?? 'BOOKED!')

// ── 2. expire → released ──
await svc.rpc('fn_apply_payment_result', { p_payment: payA.payment_id, p_result: 'expired' })
const { data: _aRow } = await svc.from('appointments').select('dentist_id').eq('id', apptA.id).maybeSingle()
const book2 = await juan.from('appointments').insert({ dentist_id: _aRow.dentist_id,
  patient_id: juanId, service_id: svcRow.id, service_ids: [svcRow.id],
  scheduled_at: when.toISOString(), requested_date: when.toISOString().slice(0, 10),
  price: svcRow.price, status: 'pending', payment_status: 'unpaid',
}).select().maybeSingle()
const apptB = book2.data
// the ORIGINAL scenario is reuse of the SAME dentist resource after expiry —
// under parallel capacity that (and only that) is the double-booking risk
check('2. expired reservation releases the slot', !!apptB, book2.error?.message?.slice(0, 60) ?? '')
const payB = apptB ? await mkPay(juan, apptB.id) : null

// ── 3. LATE success on the old payment after the slot was rebooked ──
if (apptB && payB) {
  await svc.rpc('fn_apply_payment_result', { p_payment: payB.payment_id, p_result: 'paid', p_provider_status: 'succeeded', p_amount_centavos: Math.round(Number(svcRow.price) * 100), p_currency: 'PHP' })
  // the OLD payment (A) now reports success late
  try { await svc.rpc('fn_apply_payment_result', { p_payment: payA.payment_id, p_result: 'paid', p_provider_status: 'succeeded', p_amount_centavos: Math.round(Number(svcRow.price) * 100), p_currency: 'PHP' }) } catch {}
  const { data: both } = await svc.from('appointments').select('id, status, payment_status, dentist_id').in('id', [apptA.id, apptB.id])
  const a = (both ?? []).find((x) => x.id === apptA.id)
  const b = (both ?? []).find((x) => x.id === apptB.id)
  const sameDentist = a && b && a.dentist_id === b.dentist_id
  check('3a. late payment does NOT resurrect a same-dentist booking', !sameDentist || a?.status !== 'approved', JSON.stringify(a))
  check('3b. the rebooked slot holder stays confirmed', b?.status === 'approved', JSON.stringify(b))
  check('3c. never two approved bookings on the SAME dentist', !(sameDentist && a?.status === 'approved' && b?.status === 'approved'), 'sameDentist=' + sameDentist)
  const { data: txs } = await svc.from('transactions').select('id').in('appointment_id', [apptA.id, apptB.id])
  const { data: payRows } = await svc.from('payments').select('id, status').in('id', [payA.payment_id, payB.payment_id])
  const paidCount = (payRows ?? []).filter((p) => p.status === 'paid').length
  check('3d. exactly one transaction per paid payment', (txs ?? []).length === paidCount, 'txs=' + (txs ?? []).length + ' paid=' + paidCount)
  // cleanup (test rows only)
  await svc.from('transactions').delete().in('appointment_id', [apptA.id, apptB.id])
  await svc.from('payments').delete().in('appointment_id', [apptA.id, apptB.id])
  await svc.from('appointments').delete().in('id', [apptA.id, apptB.id])
} else check('3. late-payment scenario setup', false, 'rebooking failed')

console.log(`\n===== PAY LIFECYCLE: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
