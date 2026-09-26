// capacity_qa.mjs — multi-dentist capacity contract (supabase/migrations/0021_dentist_capacity.sql).
// Mostly API/DB assertions against the live project via the service key (SB_SECRET) — the
// DB trigger fn_appt_dentist_guard is the source of truth; a short Playwright smoke covers
// the Ready toggle and the per-doctor calendar filter. All rows created here are removed.
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
const manilaToday = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date())

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
// far-future clinic dates, one per test — nothing else lives there
const [D_A, D_B, D_C, D_D, D_E, D_F, D_G, D_H, D_I, D_J] =
  ['2033-03-06', '2033-03-07', '2033-03-08', '2033-03-09', '2033-03-10', '2033-03-11', '2033-03-12', '2033-03-13', '2033-03-14', '2033-03-15']
const D_UI = '2033-03-16'
const TEST_DATES = [D_A, D_B, D_C, D_D, D_E, D_F, D_G, D_H, D_I, D_J]

// self-heal: clear leftovers of a previous crashed run (only our dates / our marker / our fake dentist)
await svc.from('appointments').delete().in('requested_date', [...TEST_DATES, D_UI]).eq('notes', 'capacity_qa')
await svc.from('dentist_ready').delete().in('clinic_date', [...TEST_DATES, D_UI])
await svc.from('dentists').delete().eq('email', 'qa-off@dentalvibe.qa')

const dent = await svc.from('dentists').select('id, full_name, email, active')
if (dent.error) { console.error('FAIL cannot read dentists: ' + dent.error.message); process.exit(1) }
const byEmail = Object.fromEntries(dent.data.map((d) => [d.email, d]))
const A = byEmail['owner@dentalvibe.ph'].id
const B = byEmail['dr.diaz@email.com'].id
const C = byEmail['doctor@dentalvibe.ph'].id // Dr. Miguel Ramos — the UI-smoke doctor
const activeIds = dent.data.filter((d) => d.active).map((d) => d.id)

const pats = await svc.from('patients').select('id, full_name')
const byName = Object.fromEntries(pats.data.map((p) => [p.full_name, p.id]))
const maria = byName['Maria Santos'], juan = byName['Juan Dela Cruz'], andrea = byName['Andrea Reyes']

const svcRow = (await svc.from('services').select('id, price').eq('name', 'Consultation').single()).data

// one deactivated dentist (none exists in seed data) — created here, removed at cleanup
const off = await svc.from('dentists')
  .insert({ full_name: 'QA Deactivated DDS', email: 'qa-off@dentalvibe.qa', role: 'doctor', active: false })
  .select('id').single()
if (off.error) { console.error('FAIL cannot create deactivated dentist: ' + off.error.message); process.exit(1) }
const OFF = off.data.id

const created = [] // appointment ids to remove at cleanup
const book = async (patient, dateISO, hhmm, { mins = 30, dentist = null, payment = 'pending' } = {}) => {
  const r = await svc.from('appointments').insert({
    patient_id: patient, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: dateISO,
    scheduled_at: at(dateISO, hhmm), duration_minutes: mins, price: svcRow.price,
    status: 'pending', payment_status: payment, notes: 'capacity_qa', ...(dentist ? { dentist_id: dentist } : {}),
  }).select('id, dentist_id')
  if (!r.error && r.data?.[0]?.id) created.push(r.data[0].id)
  return r
}

// ready state for a date: ready=false on EVERY active dentist except the readyIds (ready=true)
const setAvail = async (dateISO, readyIds) => {
  const rows = activeIds.map((id) => ({
    dentist_id: id, clinic_date: dateISO, ready: readyIds.includes(id),
    ready_at: readyIds.includes(id) ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }))
  const { error } = await svc.from('dentist_ready').upsert(rows, { onConflict: 'dentist_id,clinic_date' })
  if (error) throw error
}

// start clean: nobody else's rows on the test dates
{
  const preR = await svc.from('dentist_ready').select('id').in('clinic_date', TEST_DATES)
  const preA = await svc.from('appointments').select('id').in('requested_date', TEST_DATES)
  check('z1 test dates start empty', !preR.error && !preA.error && !preR.data.length && !preA.data.length,
    `ready=${preR.data?.length} appts=${preA.data?.length}`)
}

// ── (a) zero ready ⇒ booking fails ────────────────────────────────────────────
await setAvail(D_A, [])
{
  const r = await book(maria, D_A, '10:00')
  check('a1 zero ready ⇒ booking rejected with no dentist available',
    !!r.error && /no dentist available/.test(r.error.message), r.error?.message ?? 'insert succeeded')
}

// ── (b) one ready ⇒ first booking ok, second same-time fails ──────────────────
await setAvail(D_B, [A])
{
  const b1 = await book(maria, D_B, '10:00')
  check('b1 first booking ok, auto-assigned', !b1.error && b1.data?.[0]?.dentist_id === A, b1.error?.message)
  const b2 = await book(juan, D_B, '10:00')
  check('b2 second same-time booking rejected', !!b2.error && /no dentist available/.test(b2.error.message), b2.error?.message ?? 'insert succeeded')
}

// ── (c) two ready ⇒ same time twice, different dentists ───────────────────────
await setAvail(D_C, [A, B])
{
  const c1 = await book(maria, D_C, '10:00')
  const c2 = await book(juan, D_C, '10:00')
  const ok = !c1.error && !c2.error
  check('c1 two same-time bookings both succeed', ok, c1.error?.message || c2.error?.message)
  check('c2 assigned to different dentists', ok && c1.data[0].dentist_id !== c2.data[0].dentist_id,
    ok ? `${c1.data[0].dentist_id} vs ${c2.data[0].dentist_id}` : '')
}

// ── (d) three ready ⇒ three parallel same-time bookings all succeed ───────────
await setAvail(D_D, [A, B, C])
{
  const rs = await Promise.all([book(maria, D_D, '10:00'), book(juan, D_D, '10:00'), book(andrea, D_D, '10:00')])
  const oks = rs.filter((r) => !r.error)
  check('d1 three parallel same-time bookings all succeed', oks.length === 3,
    rs.map((r) => r.error?.message ?? 'ok').join(' / '))
  check('d2 three distinct dentists', oks.length === 3 && new Set(oks.map((r) => r.data[0].dentist_id)).size === 3)
}

// ── (e) 90m visit blocks an overlapping 30m on the SAME dentist, not another ──
await setAvail(D_E, [A, B])
{
  const e1 = await book(maria, D_E, '10:00', { mins: 90, dentist: A }) // 10:00–11:30 on A
  check('e1 90m booking on dentist A ok', !e1.error, e1.error?.message)
  const e2 = await book(juan, D_E, '10:30', { mins: 30, dentist: A })
  check('e2 overlapping 30m on same dentist rejected', !!e2.error && /overlaps/.test(e2.error.message), e2.error?.message ?? 'insert succeeded')
  const e3 = await book(andrea, D_E, '10:30', { mins: 30, dentist: B })
  check('e3 same 30m allowed on the other ready dentist', !e3.error && e3.data?.[0]?.dentist_id === B, e3.error?.message)
}

// ── (f) two concurrent inserts, one ready dentist ⇒ exactly one wins ──────────
await setAvail(D_F, [A])
{
  const rs = await Promise.all([book(maria, D_F, '10:00'), book(juan, D_F, '10:00')])
  const oks = rs.filter((r) => !r.error)
  check('f1 exactly one of two concurrent inserts wins', oks.length === 1,
    rs.map((r) => r.error?.message ?? 'ok').join(' / '))
}

// ── (g) deactivated dentist: cannot become ready, cannot receive an appointment ─
{
  const g1 = await svc.from('dentist_ready').upsert(
    { dentist_id: OFF, clinic_date: D_G, ready: true, ready_at: new Date().toISOString() },
    { onConflict: 'dentist_id,clinic_date' })
  check('g1 deactivated dentist cannot become ready', !!g1.error && /deactivated dentist cannot become ready/.test(g1.error.message), g1.error?.message ?? 'upsert succeeded')
  await setAvail(D_G, []) // every active dentist Not Ready
  const g2 = await book(maria, D_G, '10:00')
  check('g2 no appointment auto-assigned when only a deactivated dentist is left', !!g2.error && /no dentist available/.test(g2.error.message), g2.error?.message ?? 'insert succeeded')
  const g3 = await book(juan, D_G, '10:00', { dentist: OFF })
  check('g3 explicit assignment to deactivated dentist rejected', !!g3.error && /no dentist available/.test(g3.error.message), g3.error?.message ?? 'insert succeeded')
}

// ── (h) removing Ready blocks future bookings; historical appointments remain ─
await setAvail(D_H, [A])
{
  const h1 = await book(maria, D_H, '10:00')
  check('h1 booking while ready ok', !h1.error, h1.error?.message)
  await setAvail(D_H, []) // Ready removed (ready=false row) — including A
  const h2 = await book(juan, D_H, '10:00')
  check('h2 same-time booking blocked after Ready removed', !!h2.error && /no dentist available/.test(h2.error.message), h2.error?.message ?? 'insert succeeded')
  const hist = await svc.from('appointments').select('id').eq('requested_date', D_H).neq('status', 'cancelled')
  check('h3 historical appointment remains', !hist.error && hist.data.length === 1 && hist.data[0].id === h1.data?.[0]?.id,
    `count=${hist.data?.length}`)
}

// ── (i) patient cannot forge dentist assignment ───────────────────────────────
{
  const patient = anon()
  const login = await patient.auth.signInWithPassword({ email: 'maria@dentalvibe.ph', password: 'password123' })
  check('i0 patient session in', !login.error, login.error?.message)
  await setAvail(D_I, []) // nobody available
  const i1 = await patient.from('appointments').insert({
    patient_id: maria, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D_I,
    scheduled_at: at(D_I, '10:00'), duration_minutes: 30, price: svcRow.price, status: 'pending',
    notes: 'capacity_qa', dentist_id: B, // forged: B is Not Ready
  })
  check('i1 patient insert with forged dentist_id rejected', !!i1.error && /no dentist available/.test(i1.error.message), i1.error?.message ?? 'insert succeeded')
  await setAvail(D_I, [A]) // control: same insert, no dentist_id, one ready dentist
  const i2 = await patient.from('appointments').insert({
    patient_id: maria, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D_I,
    scheduled_at: at(D_I, '11:00'), duration_minutes: 30, price: svcRow.price, status: 'pending',
    notes: 'capacity_qa',
  }).select('id, dentist_id')
  if (!i2.error && i2.data?.[0]?.id) created.push(i2.data[0].id)
  check('i2 control: patient booking without dentist_id auto-assigns', !i2.error && i2.data?.[0]?.dentist_id === A, i2.error?.message)
}

// ── (j) owner can read all assignments ────────────────────────────────────────
{
  const owner = anon()
  const login = await owner.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
  check('j0 owner session in', !login.error, login.error?.message)
  const { data, error } = await owner.from('appointments')
    .select('id, dentist_id, dentists(full_name)').in('id', created)
  check('j1 owner reads every assignment with dentist names',
    !error && data?.length === created.length && data.every((r) => r.dentists?.full_name),
    error?.message ?? `got ${data?.length}/${created.length}`)
}

// ── (k) UI smoke: doctor sees only own + TBA rows, Ready toggle works; owner sees all ──
const preReadyToday = (await svc.from('dentist_ready').select('id').eq('dentist_id', C).eq('clinic_date', manilaToday())).data ?? []
{
  await setAvail(D_UI, [C, B])
  const u1 = await book(maria, D_UI, '10:00', { dentist: C })
  const u2 = await book(juan, D_UI, '11:00', { dentist: B })
  const u3 = await svc.from('appointments').insert({
    patient_id: andrea, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D_UI,
    status: 'pending', notes: 'capacity_qa',
  }).select('id') // unscheduled, no dentist → visible as TBA
  if (!u3.error && u3.data?.[0]?.id) created.push(u3.data[0].id)
  check('k0 smoke rows in', !u1.error && !u2.error && !u3.error, [u1.error, u2.error, u3.error].filter(Boolean).map((e) => e.message).join(' / '))

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
  await pg.fill('input[type="date"]', D_UI); await pg.waitForTimeout(800)
  const body = await pg.locator('body').innerText()
  check('k1 doctor sees own assignment and TBA row', body.includes('Maria Santos') && body.includes('Andrea Reyes'))
  check('k2 doctor does not see another dentist assignment', !body.includes('Juan Dela Cruz'))
  const tog = pg.locator('[data-testid="ready-toggle"]')
  check('k3 ready toggle present', await tog.count() === 1)
  const before = (await tog.innerText()).trim()
  await tog.click(); await pg.waitForTimeout(1200)
  const after = (await tog.innerText()).trim()
  check('k4 ready toggle flips state', before !== after, `${before} → ${after}`)
  await tog.click(); await pg.waitForTimeout(1200) // restore
  check('k5 ready toggle flips back', (await tog.innerText()).trim() === before)

  await login('owner@dentalvibe.ph')
  await pg.goto(BASE + '/owner/calendar', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  await pg.fill('input[type="date"]', D_UI); await pg.waitForTimeout(800)
  const obody = await pg.locator('body').innerText()
  check('k6 owner sees all assignments', obody.includes('Maria Santos') && obody.includes('Juan Dela Cruz'))
  await b.close()
}

// ── cleanup: every row this script created ────────────────────────────────────
{
  if (created.length) await svc.from('appointments').delete().in('id', created)
  await svc.from('dentist_ready').delete().in('clinic_date', [...TEST_DATES, D_UI])
  await svc.from('dentist_ready').delete().eq('dentist_id', C).eq('clinic_date', manilaToday())
    .not('id', 'in', preReadyToday.length ? `(${preReadyToday.map((r) => r.id).join(',')})` : '(00000000-0000-0000-0000-000000000000)')
  await svc.from('dentist_ready').delete().eq('dentist_id', OFF) // trigger blocks upserts, but clear any
  await svc.from('dentists').delete().eq('id', OFF)
  const leftR = await svc.from('dentist_ready').select('id').in('clinic_date', [...TEST_DATES, D_UI])
  const leftA = await svc.from('appointments').select('id').in('id', created)
  check('z2 all created rows cleaned up', !leftR.error && !leftA.error && !leftR.data.length && !leftA.data.length,
    `ready_left=${leftR.data?.length} appts_left=${leftA.data?.length}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
