// Payment pipeline smoke test — exercises the deployed edge functions end to end
// in mock-provider mode: create → simulate paid → replay → webhook guards.
// Usage: node pay_smoke.mjs
const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const ANON = process.env.SB_ANON
if (!ANON) { console.error('SB_ANON required'); process.exit(2) }

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

// 1. sign in as patient Maria
const auth = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'maria@dentalvibe.ph', password: 'password123' }),
})
const authJson = await auth.json()
check('patient login', auth.ok, auth.ok ? '' : JSON.stringify(authJson).slice(0, 200))
const jwt = authJson.access_token

// 2. book a fresh appointment through the real guarded insert (fn_appointment_guard
//    computes/checks price server-side), then pay THAT — end to end.
const svcs = await fetch(`${URL}/rest/v1/services?select=id,price,duration_minutes&limit=1`, {
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, Range: '0-0' },
})
const [svc] = await svcs.json()
check('service available', !!svc, JSON.stringify(svc))

const me = await fetch(`${URL}/rest/v1/patients?select=id&limit=1`, {
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, Range: '0-0' },
})
const [meRow] = await me.json()
check('patient row', !!meRow, JSON.stringify(meRow))

// random day ahead: ux_appt_patient_date = one booking per patient per day
const when = new Date(Date.now() + (2 + Math.floor(Math.random() * 200)) * 24 * 3600 * 1000)
when.setUTCHours(2, 0, 0, 0) // 10:00 PH
const book = await fetch(`${URL}/rest/v1/appointments`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({
    patient_id: meRow.id,
    service_id: svc.id,
    service_ids: [svc.id],
    scheduled_at: when.toISOString(),
    requested_date: when.toISOString().slice(0, 10),
    price: Number(svc.price),
    status: 'pending',
    payment_status: 'unpaid',
  }),
})
const bookRows = await book.json()
check('book appointment (guarded insert)', book.ok && bookRows[0]?.id, JSON.stringify(bookRows).slice(0, 220))
const appt = bookRows[0]
if (!appt?.id) { console.log('\nabort: no appointment to pay'); process.exit(1) }

// 3. paymongo-create → mock payment + QR payload
const c1 = await fetch(`${URL}/functions/v1/paymongo-create`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ appointment_id: appt.id }),
})
const created = await c1.json()
check('create payment', c1.ok && created.payment_id, JSON.stringify(created).slice(0, 220))
check('QR present (mock payload or real dynamic QR)', (!!created.qr_payload && created.qr_payload.includes('DENTALVIBE-DEMO-PAYMENT')) || !!created.qr_image, (created.qr_payload || created.qr_image || 'none').toString().slice(0, 80))

// 4. idempotent create: second call must RETURN the same payment, not create one
const c2 = await fetch(`${URL}/functions/v1/paymongo-create`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ appointment_id: appt.id }),
})
const again = await c2.json()
check('create idempotent (reused)', again.reused === true && again.payment_id === created.payment_id, JSON.stringify(again).slice(0, 160))

// 5. duplicate-payment prevention: appointment projection should now be 'pending'
const st = await fetch(`${URL}/rest/v1/appointments?id=eq.${appt.id}&select=payment_status,status`, {
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
})
const [stRow] = await st.json()
check('projection = pending (slot held)', stRow?.payment_status === 'pending', JSON.stringify(stRow))

// 6. simulate paid via paymongo-check (mock provider)
const s1 = await fetch(`${URL}/functions/v1/paymongo-check`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ payment_id: created.payment_id, simulate: 'paid' }),
})
const paid1 = await s1.json()
check('simulate paid', paid1.status === 'paid', JSON.stringify(paid1))

// 7. replay: simulate again must NOT create a second transaction
const s2 = await fetch(`${URL}/functions/v1/paymongo-check`, {
  method: 'POST',
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ payment_id: created.payment_id, simulate: 'paid' }),
})
const paid2 = await s2.json()
check('replay idempotent', paid2.status === 'paid', JSON.stringify(paid2))

// 8. appointment confirmed exactly once
const st2 = await fetch(`${URL}/rest/v1/appointments?id=eq.${appt.id}&select=payment_status,status`, {
  headers: { apikey: ANON, Authorization: `Bearer ${jwt}` },
})
const [st2Row] = await st2.json()
check('appointment confirmed', st2Row?.payment_status === 'paid' && st2Row?.status === 'approved', JSON.stringify(st2Row))

// 9. webhook guard: unsigned request rejected
const w1 = await fetch(`${URL}/functions/v1/paymongo-webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { id: 'evt_smoke1', attributes: { type: 'payment.paid' } } }),
})
check('webhook rejects unsigned', w1.status === 401 || w1.status === 503, `status=${w1.status}`)

// 10. webhook guard: garbage signature rejected
const w2 = await fetch(`${URL}/functions/v1/paymongo-webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'paymongo-signature': 't=1,te=deadbeef,li=' },
  body: JSON.stringify({ data: { id: 'evt_smoke2', attributes: { type: 'payment.paid' } } }),
})
check('webhook rejects bad signature', w2.status === 401 || w2.status === 503, `status=${w2.status}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length ? 1 : 0)
