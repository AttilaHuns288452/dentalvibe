// Concurrent double-click: two simultaneous paymongo-create calls for the SAME
// appointment must yield exactly ONE payment (payments_active_pending + twin path).
// Usage: SB_ANON=... node pay_race.mjs
const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const ANON = process.env.SB_ANON

const auth = await fetch(URL + '/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'maria@dentalvibe.ph', password: 'password123' }),
})
const jwt = (await auth.json()).access_token

const svcs = await fetch(URL + '/rest/v1/services?select=id,price&limit=1', { headers: { apikey: ANON, Authorization: 'Bearer ' + jwt, Range: '0-0' } })
const svc = (await svcs.json())[0]
const me = await fetch(URL + '/rest/v1/patients?select=id&limit=1', { headers: { apikey: ANON, Authorization: 'Bearer ' + jwt, Range: '0-0' } })
const meRow = (await me.json())[0]

const when = new Date(Date.now() + (300 + Math.floor(Math.random() * 400)) * 24 * 3600 * 1000)
when.setUTCHours(2, 0, 0, 0)
const book = await fetch(URL + '/rest/v1/appointments', {
  method: 'POST',
  headers: { apikey: ANON, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json', Prefer: 'return=representation' },
  body: JSON.stringify({
    patient_id: meRow.id, service_id: svc.id, service_ids: [svc.id],
    scheduled_at: when.toISOString(), requested_date: when.toISOString().slice(0, 10),
    price: Number(svc.price), status: 'pending', payment_status: 'unpaid',
  }),
})
const appt = (await book.json())[0]

const call = () =>
  fetch(URL + '/functions/v1/paymongo-create', {
    method: 'POST',
    headers: { apikey: ANON, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ appointment_id: appt.id }),
  }).then((r) => r.json())

const [r1, r2] = await Promise.all([call(), call()])
const ids = [r1.payment_id, r2.payment_id].filter(Boolean)
const uniq = new Set(ids)
console.log('r1 =', JSON.stringify(r1).slice(0, 100))
console.log('r2 =', JSON.stringify(r2).slice(0, 100))
if (uniq.size === 1 && ids.length === 2) {
  console.log('PASS concurrent double-click → single payment (' + [...uniq][0] + ')')
  process.exit(0)
}
console.log('FAIL concurrent double-click →', ids.length, 'ids,', uniq.size, 'unique')
process.exit(1)
