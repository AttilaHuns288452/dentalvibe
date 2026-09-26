// capacity_qa.mjs — multi-dentist capacity contract on WORK SCHEDULES
// (supabase/migrations/0030_dentist_work_schedules.sql): dentist_work_schedules is
// the ONLY source of booking capacity; dentist_ready is a day-of presence signal
// and NEVER gates a booking. API/DB assertions against the live project via the
// service key (SB_SECRET) + patient clients; a short Playwright smoke covers the
// per-doctor calendar view and owner visibility. All rows created here are removed.
// Run (from frontend/): SB_SECRET=... node capacity_qa.mjs   (QA_BASE defaults to http://localhost:4176)
import { chromium, createClient } from './qa_playwright.mjs'
import { slotStartsForDentists } from './src/lib/availability.js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
if (!process.env.SB_SECRET) { console.error('FAIL SB_SECRET env var missing'); process.exit(1) }
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const anon = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

// Manila wall time → instant ISO (Asia/Manila is fixed UTC+8, no DST)
const at = (dateISO, hhmm) => `${dateISO}T${hhmm}:00+08:00`

// ── pure check: capacity-aware slot union (slotStartsForDentists) ──────────────
{
  const settings = { open_time: '09:00', close_time: '12:00', open_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }
  const T = '2033-03-06'
  const mk = (hhmm, mins) => ({ start: new Date(at(T, hhmm)), mins })
  // d1 busy 09:00–10:00, d2 busy 09:30–10:30; visit = 60m
  const s = slotStartsForDentists(settings, T, 60, [[mk('09:00', 60)], [mk('09:30', 60)]])
  check('p1 slot offered iff some dentist is free for the whole visit',
    !s.includes('09:00') && !s.includes('09:30') && s.includes('10:00') && s.includes('10:30'), s.join())
  check('p2 zero available dentists ⇒ zero slots', slotStartsForDentists(settings, T, 30, []).length === 0)
}

// ── fixtures ──────────────────────────────────────────────────────────────────
// far-future SUNDAYS, one per case — seeded schedules are Mon–Sat only, so each
// test date starts with zero scheduled dentists and the case builds its own.
const [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13, D14] = [
  '2033-03-06', '2033-03-13', '2033-03-20', '2033-03-27', '2033-04-03', '2033-04-10', '2033-04-17',
  '2033-04-24', '2033-05-01', '2033-05-08', '2033-05-15', '2033-05-22', '2033-05-29', '2033-06-05',
]
const TEST_DATES = [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D12, D13, D14]

// self-heal: clear leftovers of a previous crashed run (our dates / our marker /
// our throwaway dentists — deleting a dentist cascades its schedule + ready rows)
await svc.from('appointments').delete().in('requested_date', TEST_DATES).eq('notes', 'capacity_qa')
await svc.from('dentist_ready').delete().in('clinic_date', TEST_DATES)
await svc.from('dentists').delete().like('email', 'qa-cap-%@qa.test')

const dent = await svc.from('dentists').select('id, full_name, email, active')
if (dent.error) { console.error('FAIL cannot read dentists: ' + dent.error.message); process.exit(1) }
const byEmail = Object.fromEntries(dent.data.map((d) => [d.email, d]))
const B = byEmail['dr.diaz@email.com'].id
const C = byEmail['doctor@dentalvibe.ph'].id // Dr. Miguel Ramos — the UI-smoke doctor
const activeIds = dent.data.filter((d) => d.active).map((d) => d.id)

const pats = await svc.from('patients').select('id, full_name')
const byName = Object.fromEntries(pats.data.map((p) => [p.full_name, p.id]))
const P = { maria: byName['Maria Santos'], juan: byName['Juan Dela Cruz'], andrea: byName['Andrea Reyes'] }

const svcRow = (await svc.from('services').select('id, price').eq('name', 'Consultation').single()).data

// patient clients (case c0 documents why bookings themselves are staff-side)
const authed = async (email) => {
  const c = anon()
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ' login failed: ' + error.message)
  return c
}
const mariaC = await authed('maria@dentalvibe.ph')
const juanC = await authed('juan@dentalvibe.ph')

const created = [] // appointment ids to remove at cleanup
const madeDentists = [] // throwaway dentist ids (schedules/ready cascade away with them)
const madeSchedules = [] // schedule ids created for REAL dentists (case 14) — removed explicitly

// throwaway dentist (created here, removed at cleanup)
const mkDentist = async (tag, active = true) => {
  const r = await svc.from('dentists')
    .insert({ full_name: `QA Cap ${tag}`, email: `qa-cap-${tag}-${Date.now()}@qa.test`, role: 'doctor', active })
    .select('id').single()
  if (r.error) throw new Error('cannot create dentist: ' + r.error.message)
  madeDentists.push(r.data.id)
  return r.data.id
}
// schedule row: the ONLY thing that makes a dentist a resource on that weekday
const addSched = async (id, dow = 0, open = '10:00', close = '17:00', real = false) => {
  const r = await svc.from('dentist_work_schedules')
    .insert({ dentist_id: id, day_of_week: dow, open_time: open, close_time: close })
    .select('id').single()
  if (r.error) throw new Error('cannot create schedule: ' + r.error.message)
  if (real) madeSchedules.push(r.data.id)
  return r.data
}

// book a RESERVATION (payment_status pending = counted by the guard). Patient
// inserts can only be unpaid non-reservations (fn_appointment_guard), so booking
// state is written staff-side via the service client — see check c0.
const book = async (patient, dateISO, hhmm, { mins = 30, dentist = null } = {}) => {
  const r = await svc.from('appointments').insert({
    patient_id: patient, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: dateISO,
    scheduled_at: at(dateISO, hhmm), duration_minutes: mins, price: svcRow.price,
    status: 'pending', payment_status: 'pending', notes: 'capacity_qa', ...(dentist ? { dentist_id: dentist } : {}),
  }).select('id, dentist_id')
  if (!r.error && r.data?.[0]?.id) created.push(r.data[0].id)
  return r
}
const noAvail = (r) => !!r.error && /no dentist available/.test(r.error.message)
// retire throwaway schedules at the end of each case — every test date is a
// Sunday (dow 0), so leftover schedule rows would leak capacity into later cases
const cleanScheds = () => svc.from('dentist_work_schedules').delete().in('dentist_id', madeDentists)

// ── z: test dates start empty and un-scheduled (Sunday assumption) ────────────
{
  const preA = await svc.from('appointments').select('id').in('requested_date', TEST_DATES)
  const preR = await svc.from('dentist_ready').select('id').in('clinic_date', TEST_DATES)
  check('z1 test dates start empty', !preA.error && !preR.error && !preA.data.length && !preR.data.length,
    `appts=${preA.data?.length} ready=${preR.data?.length}`)
  let scheduled = 0
  for (const d of TEST_DATES) {
    const { data } = await svc.rpc('fn_day_schedule', { p_date: d })
    scheduled += (data ?? []).length
  }
  check('z2 nobody is scheduled on the Sunday test dates (seed is Mon–Sat)', scheduled === 0, `scheduled=${scheduled}`)
}

// ── (0) patient surface: patients cannot mint reservations directly ──────────
{
  const r1 = await mariaC.from('appointments').insert({
    patient_id: P.maria, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D1,
    scheduled_at: at(D1, '11:00'), duration_minutes: 30, price: svcRow.price,
    status: 'pending', payment_status: 'pending', notes: 'capacity_qa',
  }).select('id')
  const r2 = await juanC.from('appointments').insert({
    patient_id: P.juan, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D1,
    scheduled_at: at(D1, '11:00'), duration_minutes: 30, price: svcRow.price,
    status: 'pending', payment_status: 'pending', notes: 'capacity_qa',
  }).select('id')
  // patient bookings start pending+UNPAID (fn_appointment_guard) and unpaid rows
  // are not reservations — so every capacity case below books staff-side. The
  // rejection surfaces whichever guard fires first (alphabetical trigger order).
  check('c0 patient clients cannot create reservations (patient bookings start unpaid)',
    !!r1.error && !!r2.error,
    [r1.error?.message, r2.error?.message].filter(Boolean).join(' / '))
}

// ── (1) zero SCHEDULED dentists ⇒ booking fails ───────────────────────────────
{
  const r = await book(P.maria, D1, '10:00')
  check('c1 zero scheduled dentists ⇒ booking rejected, no dentist available',
    noAvail(r), r.error?.message ?? 'insert succeeded')
}

// ── (2) one scheduled ⇒ first booking ok, second same-time fails ──────────────
{
  const T1 = await mkDentist('one')
  await addSched(T1)
  const b1 = await book(P.maria, D2, '10:00')
  check('c2a one scheduled dentist ⇒ first booking ok, auto-assigned', !b1.error && b1.data?.[0]?.dentist_id === T1, b1.error?.message)
  const b2 = await book(P.juan, D2, '10:00')
  check('c2b second same-time booking rejected (one dentist = one slot)', noAvail(b2), b2.error?.message ?? 'insert succeeded')
  await cleanScheds()
}

// ── (3) two scheduled ⇒ same time twice, different dentists ───────────────────
{
  const T2 = await mkDentist('two-a')
  const T3 = await mkDentist('two-b')
  await addSched(T2); await addSched(T3)
  const c1 = await book(P.maria, D3, '10:00')
  const c2 = await book(P.juan, D3, '10:00')
  const ok = !c1.error && !c2.error
  check('c3a two scheduled ⇒ same-time bookings both succeed', ok, c1.error?.message || c2.error?.message)
  check('c3b assigned to different dentists', ok && c1.data[0].dentist_id !== c2.data[0].dentist_id,
    ok ? `${c1.data[0].dentist_id} vs ${c2.data[0].dentist_id}` : '')
  await cleanScheds()
}

// ── (4) three scheduled ⇒ three parallel same-time bookings all succeed ───────
{
  const ids = [await mkDentist('three-a'), await mkDentist('three-b'), await mkDentist('three-c')]
  for (const id of ids) await addSched(id)
  const rs = await Promise.all([
    book(P.maria, D4, '10:00'), book(P.juan, D4, '10:00'), book(P.andrea, D4, '10:00'),
  ])
  const oks = rs.filter((r) => !r.error)
  check('c4a three parallel same-time bookings all succeed', oks.length === 3,
    rs.map((r) => r.error?.message ?? 'ok').join(' / '))
  check('c4b three distinct dentists (3 scheduled = 3 resources)',
    oks.length === 3 && new Set(oks.map((r) => r.data[0].dentist_id)).size === 3)
  await cleanScheds()
}

// ── (5) future booking works with ZERO ready rows (ready=false for everyone) ──
{
  const T5 = await mkDentist('zero-ready')
  await addSched(T5)
  const rows = [...new Set([...activeIds, T5])].map((id) => ({ dentist_id: id, clinic_date: D5, ready: false, updated_at: new Date().toISOString() }))
  const up = await svc.from('dentist_ready').upsert(rows, { onConflict: 'dentist_id,clinic_date' })
  const readyRows = (await svc.from('dentist_ready').select('id').eq('clinic_date', D5).eq('ready', false)).data ?? []
  check('c5a ready=false rows exist for every dentist on the date', !up.error && readyRows.length === rows.length,
    up.error?.message ?? `ready_false=${readyRows.length}/${rows.length}`)
  const r = await book(P.maria, D5, '10:00')
  check('c5b booking succeeds with zero ready rows (Ready never gates booking)',
    !r.error && r.data?.[0]?.dentist_id === T5, r.error?.message ?? 'insert succeeded')
  await cleanScheds()
}

// ── (6) Ready does not affect capacity: ready=false dentist stays bookable ────
{
  const T6 = await mkDentist('not-ready-a')
  const T6b = await mkDentist('not-ready-b')
  await addSched(T6); await addSched(T6b)
  await svc.from('dentist_ready').upsert(
    { dentist_id: T6, clinic_date: D6, ready: false, updated_at: new Date().toISOString() },
    { onConflict: 'dentist_id,clinic_date' })
  const c1 = await book(P.maria, D6, '10:00', { dentist: T6 })
  check('c6a ready=false dentist slot still bookable (explicit)', !c1.error && c1.data?.[0]?.dentist_id === T6, c1.error?.message)
  const c2 = await book(P.juan, D6, '10:00')
  check('c6b auto-assign ignores Ready (second same-time booking still lands)',
    !c2.error && c2.data?.[0]?.dentist_id === T6b, c2.error?.message ?? JSON.stringify(c2.data))
  await cleanScheds()
}

// ── (7) 90m visit blocks a 30m overlap on the SAME dentist, not the other ─────
{
  const T7 = await mkDentist('dur-a')
  const T7b = await mkDentist('dur-b')
  await addSched(T7); await addSched(T7b)
  const e1 = await book(P.maria, D7, '10:00', { mins: 90, dentist: T7 }) // 10:00–11:30 on T7
  check('c7a 90m booking on dentist T ok', !e1.error, e1.error?.message)
  const e2 = await book(P.juan, D7, '10:30', { mins: 30, dentist: T7 })
  check('c7b overlapping 30m on the same dentist rejected', !!e2.error && /overlaps/.test(e2.error.message), e2.error?.message ?? 'insert succeeded')
  const e3 = await book(P.andrea, D7, '10:30', { mins: 30 })
  check('c7c the other scheduled dentist takes the 30m overlap', !e3.error && e3.data?.[0]?.dentist_id === T7b, e3.error?.message)
  await cleanScheds()
}

// ── (8) simultaneous race: two concurrent inserts, one slot, one dentist ──────
{
  const T8 = await mkDentist('race')
  await addSched(T8)
  const rs = await Promise.all([
    book(P.maria, D8, '10:00', { dentist: T8 }),
    book(P.juan, D8, '10:00', { dentist: T8 }),
  ])
  const oks = rs.filter((r) => !r.error)
  check('c8a exactly one of two concurrent same-slot inserts wins', oks.length === 1,
    rs.map((r) => r.error?.message ?? 'ok').join(' / '))
  check('c8b the loser is rejected with the overlap error',
    oks.length === 1 && rs.some((r) => r.error && /overlaps/.test(r.error.message)))
  await cleanScheds()
}

// ── (9) deactivated dentist: no assignment, no Ready, no explicit assignment ──
{
  const T9 = await mkDentist('off', false) // deactivated WITH a schedule — deactivation wins
  await addSched(T9)
  const g1 = await book(P.maria, D9, '10:00')
  check('c9a deactivated dentist excluded from auto-assignment (schedule row alone is not enough)',
    noAvail(g1), g1.error?.message ?? 'insert succeeded')
  const g2 = await svc.from('dentist_ready').upsert(
    { dentist_id: T9, clinic_date: D9, ready: true, ready_at: new Date().toISOString() },
    { onConflict: 'dentist_id,clinic_date' })
  check('c9b deactivated dentist cannot become Ready (guard raises)',
    !!g2.error && /deactivated dentist cannot become ready/.test(g2.error.message), g2.error?.message ?? 'upsert succeeded')
  const g3 = await book(P.juan, D9, '10:00', { dentist: T9 })
  check('c9c explicit assignment to deactivated dentist rejected', noAvail(g3), g3.error?.message ?? 'insert succeeded')
  await cleanScheds()
}

// ── (10) NEW dentist expands capacity exactly when a schedule row exists ──────
{
  const T10 = await mkDentist('new')
  const f1 = await book(P.maria, D10, '10:00')
  check('c10a new dentist without a schedule row ⇒ booking blocked', noAvail(f1), f1.error?.message ?? 'insert succeeded')
  await addSched(T10)
  const f2 = await book(P.juan, D10, '11:00')
  check('c10b one schedule row added ⇒ date becomes bookable', !f2.error && f2.data?.[0]?.dentist_id === T10, f2.error?.message)
  await cleanScheds()
}

// ── (11) historical appointments survive schedule removal + deactivation ─────
{
  const T11 = await mkDentist('hist')
  const sched = await addSched(T11)
  const h1 = await book(P.maria, D11, '10:00')
  check('c11a booking auto-assigned before removal', !h1.error && h1.data?.[0]?.dentist_id === T11, h1.error?.message)
  await svc.from('dentist_work_schedules').delete().eq('id', sched.id) // schedule removed
  await svc.from('dentists').update({ active: false }).eq('id', T11) // dentist deactivated
  const hist = await svc.from('appointments').select('id, dentist_id, status, payment_status, scheduled_at')
    .eq('id', h1.data?.[0]?.id).single()
  check('c11b historical appointment intact after schedule removal + deactivation',
    !hist.error && hist.data.dentist_id === T11 && hist.data.status === 'pending' && hist.data.payment_status === 'pending'
      && new Date(hist.data.scheduled_at).getTime() === new Date(at(D11, '10:00')).getTime(),
    hist.error?.message ?? JSON.stringify(hist.data))
  await cleanScheds()
}

// ── (12) forged dentist_id for an unscheduled dentist rejected ────────────────
{
  const T12 = await mkDentist('forged')
  await addSched(T12)
  const i1 = await book(P.maria, D12, '10:00', { dentist: B }) // B has no Sunday schedule
  check('c12a forged dentist_id for an unscheduled dentist rejected', noAvail(i1), i1.error?.message ?? 'insert succeeded')
  const i2 = await book(P.juan, D12, '10:00')
  check('c12b control: same booking without dentist_id auto-assigns to the scheduled dentist',
    !i2.error && i2.data?.[0]?.dentist_id === T12, i2.error?.message)
  await cleanScheds()
}

// ── (13) per-dentist working hours respected ──────────────────────────────────
{
  const AM = await mkDentist('am') // 09:00–12:00
  const PM = await mkDentist('pm') // 13:00–16:00
  await addSched(AM, 0, '09:00', '12:00')
  await addSched(PM, 0, '13:00', '16:00')
  const h1 = await book(P.maria, D13, '13:30', { dentist: AM })
  check('c13a outside a dentist’s working hours rejected even though the day is covered', noAvail(h1), h1.error?.message ?? 'insert succeeded')
  const h2 = await book(P.juan, D13, '13:30', { dentist: PM })
  check('c13b accepted for the dentist whose hours cover it', !h2.error && h2.data?.[0]?.dentist_id === PM, h2.error?.message)
  const h3 = await book(P.andrea, D13, '10:00')
  check('c13c auto-assign only considers the dentist whose hours cover the slot',
    !h3.error && h3.data?.[0]?.dentist_id === AM, h3.error?.message ?? JSON.stringify(h3.data))
  await cleanScheds()
}

// ── (14)+(15) doctor isolation + owner visibility (calendar view smoke) ───────
{
  await addSched(C, 0, '10:00', '17:00', true) // real dentists, temporary Sunday rows
  await addSched(B, 0, '10:00', '17:00', true)
  const u1 = await book(P.maria, D14, '10:00', { dentist: C })
  const u2 = await book(P.juan, D14, '11:00', { dentist: B })
  const u3 = await svc.from('appointments').insert({
    patient_id: P.andrea, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D14,
    status: 'pending', notes: 'capacity_qa', // unscheduled TBA row (unpaid → not a reservation)
  }).select('id')
  if (!u3.error && u3.data?.[0]?.id) created.push(u3.data[0].id)
  check('k0 smoke rows in (two assigned + one TBA)', !u1.error && !u2.error && !u3.error,
    [u1.error, u2.error, u3.error].filter(Boolean).map((e) => e.message).join(' / '))

  const b = await chromium.launch()
  const pg = await b.newPage()
  const login = async (email) => {
    await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
    await pg.fill('input[type="email"]', email); await pg.fill('input[type="password"]', 'password123')
    await pg.locator('form button:has-text("Sign In")').last().click(); await pg.waitForTimeout(2500)
  }

  await login('doctor@dentalvibe.ph')
  await pg.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  await pg.fill('input[type="date"]', D14); await pg.waitForTimeout(800)
  const body = await pg.locator('body').innerText()
  check('k1 doctor sees own assignment and TBA row', body.includes('Maria Santos') && body.includes('Andrea Reyes'))
  check('k2 doctor does not see another dentist’s assignment', !body.includes('Juan Dela Cruz'))

  await login('owner@dentalvibe.ph')
  await pg.goto(BASE + '/owner/calendar', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  await pg.fill('input[type="date"]', D14); await pg.waitForTimeout(800)
  const obody = await pg.locator('body').innerText()
  check('k6 owner sees all assignments', obody.includes('Maria Santos') && obody.includes('Juan Dela Cruz'))
  await b.close()
}

// ── (15) owner API visibility: every assignment readable with dentist names ───
{
  const owner = anon()
  const login = await owner.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
  check('j0 owner session in', !login.error, login.error?.message)
  const { data, error } = await owner.from('appointments')
    .select('id, dentist_id, dentists(full_name)').in('id', created)
  check('j1 owner API reads every assignment with dentist names',
    !error && data?.length === created.length && data.every((r) => !r.dentist_id || r.dentists?.full_name),
    error?.message ?? `got ${data?.length}/${created.length}`)
}

// ── cleanup: every row this script created ────────────────────────────────────
{
  if (created.length) await svc.from('appointments').delete().in('id', created)
  await svc.from('dentist_ready').delete().in('clinic_date', TEST_DATES)
  if (madeSchedules.length) await svc.from('dentist_work_schedules').delete().in('id', madeSchedules)
  await svc.from('dentists').delete().in('id', madeDentists) // cascades schedule + ready rows
  await svc.from('dentists').delete().like('email', 'qa-cap-%@qa.test')
  const leftA = await svc.from('appointments').select('id').in('id', created)
  const leftR = await svc.from('dentist_ready').select('id').in('clinic_date', TEST_DATES)
  const leftD = await svc.from('dentists').select('id').like('email', 'qa-cap-%@qa.test')
  const leftS = await svc.from('dentist_work_schedules').select('id').in('id', madeSchedules)
  check('z3 all created rows cleaned up',
    !leftA.error && !leftR.error && !leftD.error && !leftS.error
      && !leftA.data.length && !leftR.data.length && !leftD.data.length && !leftS.data.length,
    `appts=${leftA.data?.length} ready=${leftR.data?.length} dentists=${leftD.data?.length} scheds=${leftS.data?.length}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
