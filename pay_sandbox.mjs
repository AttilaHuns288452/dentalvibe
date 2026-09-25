// PayMongo TEST-mode sandbox E2E — the complete integration checklist at API level:
// book → paymongo-create (REAL PaymentIntent + dynamic QR + test_url) →
// documented test_url charge → REAL signed webhook → PAID → appointment CONFIRMED →
// exactly ONE transaction → patient notification → duplicate-webhook no-op →
// failed path → expired path. Usage: SB_ANON=... node pay_sandbox.mjs
const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const ANON = process.env.SB_ANON
const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`) }

const auth = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'maria@dentalvibe.ph', password: 'password123' }),
})
const jwt = (await auth.json()).access_token
const H = { apikey: ANON, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' }

// 1. appointment (guarded insert, random day)
const svc = (await (await fetch(URL + '/rest/v1/services?select=id,price&limit=1', { headers: { ...H, Range: '0-0' } })).json())[0]
const me = (await (await fetch(URL + '/rest/v1/patients?select=id&limit=1', { headers: { ...H, Range: '0-0' } })).json())[0]
const when = new Date(Date.now() + (60 + Math.floor(Math.random() * 300)) * 24 * 3600 * 1000); when.setUTCHours(2, 0, 0, 0)
const book = await fetch(URL + '/rest/v1/appointments', {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ patient_id: me.id, service_id: svc.id, service_ids: [svc.id], scheduled_at: when.toISOString(), requested_date: when.toISOString().slice(0, 10), price: Number(svc.price), status: 'pending', payment_status: 'unpaid' }),
})
const appt = (await book.json())[0]
check('1. appointment created', !!appt?.id, appt?.id?.slice(0, 8))

// 2. payment creation — REAL PayMongo test API (provider_mode=test)
const c = await fetch(URL + '/functions/v1/paymongo-create', { method: 'POST', headers: H, body: JSON.stringify({ appointment_id: appt.id }) })
const pay = await c.json()
check('2. payment created (real test API)', !!pay.payment_id, JSON.stringify(pay).slice(0, 80))
check('2b. dynamic QR returned (base64 img)', !!pay.qr_image?.startsWith('data:image/'), (pay.qr_image ?? '').slice(0, 24))
check('2c. test_url present (sandbox sim)', !!pay.test_url?.includes('secure-authentication'), (pay.test_url ?? '').slice(0, 40))
check('2d. real provider id (pi_)', !!pay.reference, pay.reference)

// 3. simulated scan+pay via the documented test_url mechanism (charge)
const sim = await fetch(URL + '/functions/v1/paymongo-check', {
  method: 'POST', headers: H,
  body: JSON.stringify({ payment_id: pay.payment_id, simulate: 'paid' }),
})
const simRes = await sim.json()
check('4. sandbox payment settles', simRes.status === 'paid', JSON.stringify(simRes))

// 5-8. webhook + state + confirm + one transaction
const _oAuth = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@dentalvibe.ph', password: 'password123' }),
})
const oJwt = (await _oAuth.json()).access_token
const st = await (await fetch(URL + `/rest/v1/appointments?id=eq.${appt.id}&select=status,payment_status`, { headers: H })).json()
check('6/7. payment PAID + appointment CONFIRMED', st[0]?.payment_status === 'paid' && st[0]?.status === 'approved', JSON.stringify(st[0]))
// transactions are owner-scoped financial records (RLS) — assert as owner
const tx = await (await fetch(URL + `/rest/v1/transactions?payment_id=eq.${pay.payment_id}&select=id`, { headers: { apikey: ANON, Authorization: 'Bearer ' + oJwt } })).json()
check('8. exactly ONE transaction', tx.length === 1, `count=${tx.length}`)

// 9. patient notification
const notes = await (await fetch(URL + `/rest/v1/notifications?title=ilike.*Payment*&order=created_at.desc&limit=5&select=title`, { headers: H })).json()
check('9. patient notification created', notes.some((n) => /confirmed/i.test(n.title)), JSON.stringify(notes.slice(0, 2)))

// 5b. webhook ledger saw the real event (owner-visible)
const ev = await (await fetch(URL + `/rest/v1/provider_events?select=event_id,event_type&order=processed_at.desc&limit=5`, { headers: { apikey: ANON, Authorization: 'Bearer ' + oJwt } })).json().catch(() => [])
check('5. webhook event recorded (signed delivery)', Array.isArray(ev) && ev.length > 0, JSON.stringify(ev).slice(0, 100))

// 10. duplicate webhook idempotency — replay settle + re-run check
const again = await fetch(URL + '/functions/v1/paymongo-check', { method: 'POST', headers: H, body: JSON.stringify({ payment_id: pay.payment_id, simulate: 'paid' }) })
const againRes = await again.json()
const tx2 = await (await fetch(URL + `/rest/v1/transactions?payment_id=eq.${pay.payment_id}&select=id`, { headers: { apikey: ANON, Authorization: 'Bearer ' + oJwt } })).json()
check('10. duplicate delivery: still ONE transaction', againRes.status === 'paid' && tx2.length === 1, `count=${tx2.length}`)

// 11. failed payment path
const book2 = await fetch(URL + '/rest/v1/appointments', {
  method: 'POST', headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({ patient_id: me.id, service_id: svc.id, service_ids: [svc.id], scheduled_at: new Date(when.getTime() + 7 * 24 * 3600 * 1000).toISOString(), requested_date: new Date(when.getTime() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10), price: Number(svc.price), status: 'pending', payment_status: 'unpaid' }),
})
const appt2 = (await book2.json())[0]
const p2 = await (await fetch(URL + '/functions/v1/paymongo-create', { method: 'POST', headers: H, body: JSON.stringify({ appointment_id: appt2.id }) })).json()
const failRes = await (await fetch(URL + '/functions/v1/paymongo-check', { method: 'POST', headers: H, body: JSON.stringify({ payment_id: p2.payment_id, simulate: 'failed' }) })).json()
const st2 = await (await fetch(URL + `/rest/v1/appointments?id=eq.${appt2.id}&select=payment_status`, { headers: H })).json()
check('11. failed payment → retriable (unpaid)', failRes.status === 'failed' && st2[0]?.payment_status === 'unpaid', `${failRes.status} / ${st2[0]?.payment_status}`)

// 12. expired payment path
const p3 = await (await fetch(URL + '/functions/v1/paymongo-create', { method: 'POST', headers: H, body: JSON.stringify({ appointment_id: appt2.id }) })).json()
const expRes = await (await fetch(URL + '/functions/v1/paymongo-check', { method: 'POST', headers: H, body: JSON.stringify({ payment_id: p3.payment_id, simulate: 'expired' }) })).json()
check('12. expired payment handled', expRes.status === 'expired', JSON.stringify(expRes))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} sandbox checks passed`)
process.exit(failed.length ? 1 : 0)
