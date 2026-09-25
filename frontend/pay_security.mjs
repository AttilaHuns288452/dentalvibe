// pay_security.mjs — adversarial probes for the money path + finance linkage.
// A patient must never: self-settle a payment, flip payment status, write
// income, or change prices. Booking price is validated SERVER-side. The QR
// amount comes from the appointment price (service base or per-patient
// exception) — never from client input. Finance (transactions) must record
// exactly what was paid.
// Run (from frontend/): SB_SECRET=<service key> node pay_security.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SB_SECRET)
const maria = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

await maria.auth.signInWithPassword({ email: 'maria@dentalvibe.ph', password: 'password123' })
const svcRow = (await svc.from('services').select('id, price').order('price', { ascending: false }).limit(1)).data?.[0]
const DAY = 30 + Math.floor(Math.random() * 300)
const me = (await maria.from('patients').select('id').eq('user_id', (await maria.auth.getUser()).data.user.id).maybeSingle()).data
if (!me) { console.log('FAIL no patient row for maria'); process.exit(1) }

// ── 1. self-settle attempts (the classic fraud) ──
const { data: payRow } = await svc.from('payments').select('id, appointment_id, amount').eq('status', 'pending').limit(1).maybeSingle()
if (payRow) {
  const r = await maria.from('payments').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', payRow.id).select()
  check('1a. patient cannot self-settle a payment', !!r.error || (r.data ?? []).length === 0, r.error?.code ?? 'rows:' + (r.data ?? []).length)
  const r2 = await maria.from('payments').update({ amount: 1 }).eq('id', payRow.id).select()
  check('1b. patient cannot alter a payment amount', !!r2.error || (r2.data ?? []).length === 0, r2.error?.code ?? 'rows:' + (r2.data ?? []).length)
} else check('1a/1b. pending payment available to probe', false, 'no pending payment')

// ── 2. appointment status tamper (must target a NOT-YET-PAID row or the test is vacuous) ──
let { data: myAppt } = await svc.from('appointments').select('id, payment_status').eq('patient_id', me.id).neq('payment_status', 'paid').limit(1).maybeSingle()
if (!myAppt) {
  const mk = await maria.from('appointments').insert({
    patient_id: me.id, service_id: svcRow?.id, service_ids: svcRow ? [svcRow.id] : [],
    scheduled_at: new Date(Date.now() + (DAY + 1) * 864e5).toISOString(), requested_date: new Date(Date.now() + (DAY + 1) * 864e5).toISOString().slice(0, 10),
    price: svcRow?.price ?? 100, status: 'pending', payment_status: 'unpaid',
  }).select()
  myAppt = mk.data?.[0] ? { id: mk.data[0].id, payment_status: 'unpaid' } : null
}
if (myAppt && myAppt.payment_status !== 'paid') {
  const r = await maria.from('appointments').update({ payment_status: 'paid', status: 'approved' }).eq('id', myAppt.id).select()
  const after = (await svc.from('appointments').select('payment_status, status').eq('id', myAppt.id).maybeSingle()).data
  check('2. patient cannot self-confirm an appointment', after?.payment_status !== 'paid', JSON.stringify({ attempt: r.error?.code ?? ('rows:' + (r.data ?? []).length), after }))
} else check('2. unpaid appointment available to probe', false)

// ── 3. income fraud ──
const insTx = await maria.from('transactions').insert({ type: 'income', category: 'Service payment', amount: 9999, patient_name: 'x', entry_date: '2026-09-25' })
check('3. patient cannot insert income', !!insTx.error, insTx.error?.code ?? 'INSERTED!')

// ── 4. price exception self-service ──
const insExc = await maria.from('service_prices').insert({ service_id: svcRow.id, patient_id: me.id, price: 1 })
check('4. patient cannot set their own price', !!insExc.error, insExc.error?.code ?? 'INSERTED!')

// ── 5. booking price tamper (server-side validation) ──
const when = new Date(Date.now() + DAY * 864e5); when.setUTCHours(2, 0, 0, 0)
const tamper = await maria.from('appointments').insert({
  patient_id: me.id, service_id: svcRow.id, service_ids: [svcRow.id],
  scheduled_at: when.toISOString(), requested_date: when.toISOString().slice(0, 10),
  price: 1, status: 'pending', payment_status: 'unpaid',
}).select()
check('5. booking with a fake price is rejected', !!tamper.error && /price/i.test(tamper.error.message), tamper.error?.message?.slice(0, 60) ?? 'ACCEPTED')

// ── 6. configurable price flows correctly (per-patient exception) ──
const EXC = 555
await svc.from('service_prices').insert({ service_id: svcRow.id, patient_id: me.id, price: EXC })
const book = await maria.from('appointments').insert({
  patient_id: me.id, service_id: svcRow.id, service_ids: [svcRow.id],
  scheduled_at: when.toISOString(), requested_date: when.toISOString().slice(0, 10),
  price: EXC, status: 'pending', payment_status: 'unpaid',
}).select()
const appt = book.data?.[0]
check('6a. booking accepts the configured exception price', !!appt, book.error?.message?.slice(0, 60) ?? '')

if (appt) {
  // 7. create ignores client-supplied amounts
  const { data: created } = await maria.functions.invoke('paymongo-create', { body: { appointment_id: appt.id, amount: 1, price: 1 } })
  check('7a. QR amount = configured price, not client input', Number(created?.amount) === EXC, 'got ' + created?.amount)
  // 8. cannot pay someone else's appointment
  const { data: other } = await svc.from('appointments').select('id').neq('patient_id', me.id).limit(1).maybeSingle()
  const foreign = await maria.functions.invoke('paymongo-create', { body: { appointment_id: other?.id } })
  check('8. cannot open a payment on another patient', !!foreign.error || !!foreign.data?.error, JSON.stringify(foreign.data?.error ?? foreign.error?.message ?? '').slice(0, 60))
  // 9. settle -> exactly one transaction for exactly the configured price
  await maria.functions.invoke('paymongo-check', { body: { payment_id: created.payment_id, simulate: 'paid' } })
  const { data: txs } = await svc.from('transactions').select('amount, category, payment_id').eq('appointment_id', appt.id)
  check('9a. settle creates exactly ONE transaction', (txs ?? []).length === 1, 'count=' + (txs ?? []).length)
  check('9b. transaction amount = configured price (' + EXC + ')', Number(txs?.[0]?.amount) === EXC, 'got ' + txs?.[0]?.amount)
  check('9c. transaction categorized as service payment', txs?.[0]?.category === 'Service payment', txs?.[0]?.category)
  // 10. finance source of truth = transactions (IncomeHub reads only these)
  const { data: sumRow } = await svc.from('transactions').select('amount').eq('appointment_id', appt.id)
  const income = (sumRow ?? []).reduce((s, t) => s + Number(t.amount), 0)
  check('10. income math over transactions = amount paid', income === EXC, 'sum=' + income)
  // duplicate settle must not double the income
  await maria.functions.invoke('paymongo-check', { body: { payment_id: created.payment_id, simulate: 'paid' } })
  const { data: txs2 } = await svc.from('transactions').select('id').eq('appointment_id', appt.id)
  check('11. re-settle does NOT double income', (txs2 ?? []).length === 1, 'count=' + (txs2 ?? []).length)

  // cleanup (test rows only)
  await svc.from('transactions').delete().eq('appointment_id', appt.id)
  await svc.from('payments').delete().eq('appointment_id', appt.id)
  await svc.from('notifications').delete().like('body', '%arrive 10 minutes early%')
}
if (appt) await svc.from('appointments').delete().eq('id', appt.id)
await svc.from('service_prices').delete().eq('service_id', svcRow.id).eq('patient_id', me.id)
await svc.from('appointments').delete().eq('patient_id', me.id).gte('requested_date', new Date(Date.now() + 25 * 864e5).toISOString().slice(0, 10))

console.log(`\n===== PAY SECURITY: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
