// owner_ops_qa.mjs — owner work-schedule ops contract (supabase/migrations/0030_dentist_work_schedules.sql).
// Booking capacity comes ONLY from dentist_work_schedules; dentist_ready is day-of ops state.
// API/DB assertions via the service key (SB_SECRET) + Playwright smokes of /owner/schedules
// and the doctor Ready toggle. Every row created here is removed (work schedules of the
// dentists touched are snapshotted and restored).
// Run (from frontend/): SB_SECRET=... node owner_ops_qa.mjs   (QA_BASE defaults to http://localhost:4176)
import { chromium, createClient } from './qa_playwright.mjs'
import { slotStartsForDentists } from './src/lib/availability.js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
process.env.SB_SECRET ||= env.SB_SECRET // env fix: service key may live in .env.local (gitignored)
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
// Manila 'HH' for an instant — appointments are stored UTC, never slice the ISO string
const manilaHour = (ts) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila', hour: '2-digit', hourCycle: 'h23',
}).format(new Date(ts))
const dow = (dateISO) => new Date(dateISO + 'T12:00:00Z').getUTCDay()
const dateWithDow = (fromISO, targetDow) => {
  let d = fromISO
  while (dow(d) !== targetDow) {
    const n = new Date(d + 'T12:00:00Z'); n.setUTCDate(n.getUTCDate() + 1)
    d = n.toISOString().slice(0, 10)
  }
  return d
}
const today = manilaToday()

// ── pure check: per-dentist hours clip + union (slotStartsForDentists) ─────────
{
  const settings = { open_time: '10:00', close_time: '17:00', open_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }
  const T = '2034-06-06' // Tuesday
  const s1 = slotStartsForDentists(settings, T, 30, [{ open_time: '08:00', close_time: '09:00', busy: [] }])
  check('p1 dentist hours fully outside clinic hours ⇒ zero slots', s1.length === 0, s1.join())
  const s2 = slotStartsForDentists(settings, T, 30, [
    { open_time: '09:00', close_time: '11:00', busy: [{ start: new Date(at(T, '10:00')), mins: 30 }] },
  ])
  check('p2 own hours ∩ clinic hours + busy clipping', s2.join() === '10:30', s2.join())
  const s3 = slotStartsForDentists(settings, T, 30, [
    { open_time: '10:00', close_time: '11:00', busy: [] }, { open_time: '16:00', close_time: '17:00', busy: [] },
  ])
  check('p3 union of disjoint per-dentist hour windows', s3.includes('10:00') && s3.includes('16:30') && !s3.includes('12:00'), s3.join())
  const s4 = slotStartsForDentists(settings, T, 30, [[]])
  check('p4 legacy busy-array entry = clinic hours (compat)', s4.includes('10:00') && s4.includes('16:30'), `${s4.length} slots`)
}

// ── fixtures ──────────────────────────────────────────────────────────────────
const D_SUN = dateWithDow('2034-06-01', 0) // Sunday — no seeded schedule rows
const D_TUE = dateWithDow('2034-06-01', 2) // Tuesday — normal scheduled day
const TEST_DATES = [D_SUN, D_TUE]
const OFF_EMAIL = 'qa-offops@dentalvibe.qa'
const OWNER_EMAIL = 'qa-owner-nodentist@dentalvibe.qa'

// self-heal: leftovers of a previous crashed run (only our rows)
await svc.from('appointments').delete().eq('notes', 'owner_ops_qa').in('requested_date', [...TEST_DATES, today])
await svc.from('dentists').delete().eq('email', OFF_EMAIL)
const stale = await svc.from('dentists').select('id').eq('email', OFF_EMAIL)
if (stale.data?.length) await svc.from('dentist_work_schedules').delete().in('dentist_id', stale.data.map((r) => r.id))
const delQaUser = async (email) => {
  const { data } = await svc.auth.admin.listUsers()
  const u = (data?.users ?? []).find((x) => x.email === email)
  if (!u) return
  await svc.from('patients').delete().eq('email', email)
  await svc.from('profiles').delete().eq('id', u.id)
  await svc.auth.admin.deleteUser(u.id)
}
await delQaUser(OWNER_EMAIL)

const dent = await svc.from('dentists').select('id, full_name, email, active')
if (dent.error) { console.error('FAIL cannot read dentists: ' + dent.error.message); process.exit(1) }
const byEmail = Object.fromEntries(dent.data.map((d) => [d.email, d]))
const A = byEmail['owner@dentalvibe.ph'].id // owner-as-provider dentist row
const C = byEmail['doctor@dentalvibe.ph'].id // Dr. Miguel Ramos — the UI doctor
const B = byEmail['dr.diaz@email.com'].id
const ACTIVE = [A, B, C]

const pats = await svc.from('patients').select('id, full_name')
const byName = Object.fromEntries(pats.data.map((p) => [p.full_name, p.id]))
const { maria, juan, andrea, carlo } = Object.fromEntries(
  ['Maria Santos', 'Juan Dela Cruz', 'Andrea Reyes', 'Carlo Bautista'].map((n) => [n.split(' ')[0].toLowerCase(), byName[n]]))
const liza = byName['Liza Mendoza']
const svcRow = (await svc.from('services').select('id, price').eq('name', 'Consultation').single()).data

// snapshots for exact restore at cleanup — taken AFTER self-heal so a suite-owned
// leftover row can never be snapshotted and resurrected by the restore
await svc.from('dentist_work_schedules').delete().in('dentist_id', [A, B, C]).eq('day_of_week', 0) // Sunday rows are suite-owned
const preSched = (await svc.from('dentist_work_schedules').select('dentist_id, day_of_week, open_time, close_time, active')
  .in('dentist_id', [A, B, C])).data ?? []
const preReadyToday = (await svc.from('dentist_ready').select('dentist_id, clinic_date, ready, ready_at')
  .eq('clinic_date', today).in('dentist_id', ACTIVE)).data ?? []

const created = [] // appointment ids to remove at cleanup
const book = async (patient, dateISO, hhmm, { mins = 30, dentist = null, payment = 'pending' } = {}) => {
  const r = await svc.from('appointments').insert({
    patient_id: patient, service_id: svcRow.id, service_ids: [svcRow.id], requested_date: dateISO,
    scheduled_at: at(dateISO, hhmm), duration_minutes: mins, price: svcRow.price,
    status: 'pending', payment_status: payment, notes: 'owner_ops_qa', ...(dentist ? { dentist_id: dentist } : {}),
  }).select('id, dentist_id')
  if (!r.error && r.data?.[0]?.id) created.push(r.data[0].id)
  return r
}
const daySchedule = async (dateISO) => (await svc.rpc('fn_day_schedule', { p_date: dateISO })).data ?? []

// ── (1) schedule editor saves; a new weekday row expands bookable slots ───────
{
  const pre = await daySchedule(D_SUN)
  check('1a baseline: no dentist scheduled on a Sunday', !pre.some((r) => r.dentist_id === C) && pre.length === 0, JSON.stringify(pre))
  const b0 = await book(juan, D_SUN, '08:00')
  check('1b baseline: booking on an unscheduled weekday rejected', !!b0.error && /no dentist available/.test(b0.error.message), b0.error?.message ?? 'insert succeeded')

  // UI: owner turns on Ramos' Sunday row 08:00–09:00 and saves
  const b = await chromium.launch()
  const pg = await b.newPage()
  const login = async (email) => {
    await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
    await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
    await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
    await pg.fill('input[type="email"]', email); await pg.fill('input[type="password"]', 'password123')
    await pg.locator('form button:has-text("Sign In")').last().click(); await pg.waitForTimeout(2500)
  }
  await login('owner@dentalvibe.ph')
  await pg.goto(BASE + '/owner/schedules', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const body = (await pg.locator('body').innerText()).toLowerCase()
  check('1c schedules page renders work-schedule editor + ops panel',
    body.includes('work schedules') && body.includes("today's operations") && body.includes('conflict warnings'))
  await pg.locator(`[data-testid="sched-day-${C}-0"]`).click()
  const row = pg.locator(`[data-testid="sched-row-${C}-0"]`)
  await row.locator('input[type="time"]').nth(0).fill('08:00')
  await row.locator('input[type="time"]').nth(1).fill('09:00')
  await pg.locator(`[data-testid="sched-save-${C}"]`).click()
  await pg.waitForTimeout(1500)
  const msg = await pg.locator(`[data-testid="sched-msg-${C}"]`).innerText()
  check('1d schedule editor saves with visible success', /Saved/.test(msg), msg)

  const post = await daySchedule(D_SUN)
  const cRow = post.find((r) => r.dentist_id === C)
  check('1e new weekday row lands in fn_day_schedule with its hours',
    !!cRow && cRow.open_time.slice(0, 5) === '08:00' && cRow.close_time.slice(0, 5) === '09:00', JSON.stringify(cRow))
  const b1 = await book(maria, D_SUN, '08:00')
  check('1f booking at the new weekday row succeeds and lands on that dentist',
    !b1.error && b1.data?.[0]?.dentist_id === C, b1.error?.message ?? String(b1.data?.[0]?.dentist_id))

  // ── (2) removing the rows removes the slots; the historical appointment stays ──
  await svc.from('dentist_work_schedules').delete().eq('dentist_id', C)
  const post2 = await daySchedule(D_SUN)
  check('2a dentist gone from fn_day_schedule after rows removed', !post2.some((r) => r.dentist_id === C), JSON.stringify(post2))
  const b2 = await book(juan, D_SUN, '08:00')
  check('2b booking rejected once rows are removed', !!b2.error && /no dentist available/.test(b2.error.message), b2.error?.message ?? 'insert succeeded')
  const hist = await svc.from('appointments').select('id').eq('id', created[0])
  check('2c historical appointment still present', !hist.error && hist.data.length === 1, `count=${hist.data?.length}`)
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const none = await pg.locator(`[data-testid="sched-none-${C}"]`).innerText()
  check('2d dentist labeled "No working schedule — not bookable"', /not bookable/.test(none), none)
  // restore rows from snapshot (the suite's edits are undone here, final restore also at cleanup)
  await svc.from('dentist_work_schedules').delete().eq('dentist_id', C)
  if (preSched.filter((r) => r.dentist_id === C).length) {
    await svc.from('dentist_work_schedules').insert(preSched.filter((r) => r.dentist_id === C))
  }

  // ── (3)(4) today's ops panel + hour-conflict warning ─────────────────────────
  // make sure today's weekday rows exist for every active dentist (snapshot restores)
  const todayRow = { open_time: '10:00', close_time: '17:00', active: true }
  for (const id of ACTIVE) {
    await svc.from('dentist_work_schedules').upsert(
      { dentist_id: id, day_of_week: dow(today), ...todayRow, updated_at: new Date().toISOString() },
      { onConflict: 'dentist_id,day_of_week' })
  }
  // pick a free hour today (no reserved visits), book two parallel appointments at it
  const dayEnd = new Date(new Date(at(today, '00:00')).getTime() + 864e5).toISOString()
  const existing = (await svc.from('appointments').select('scheduled_at, payment_status, status')
    .gte('scheduled_at', at(today, '00:00')).lt('scheduled_at', dayEnd)).data ?? []
  const usedHours = new Set(existing.filter((a) => ['pending', 'paid'].includes(a.payment_status) && a.status !== 'cancelled')
    .map((a) => manilaHour(a.scheduled_at)))
  const hour = ['11', '12', '13', '14', '15', '16'].find((h) => !usedHours.has(h)) ?? '16'
  const t1 = await book(maria, today, hour + ':00')
  const t2 = await book(juan, today, hour + ':00')
  check('3a two parallel appointments today booked', !t1.error && !t2.error,
    [t1.error, t2.error].filter(Boolean).map((e) => e.message).join(' / '))

  // day-of state via API: owner dentist + Diaz Not Ready, Ramos Ready → panel must reflect it
  const readyRows = ACTIVE.map((id) => ({
    dentist_id: id, clinic_date: today, ready: id === C,
    ready_at: id === C ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }))
  const ru = await svc.from('dentist_ready').upsert(readyRows, { onConflict: 'dentist_id,clinic_date' })
  check('3b ready rows set via API', !ru.error, ru.error?.message)

  const schedIds = (await daySchedule(today)).map((r) => r.dentist_id)
  const readyIds = schedIds.filter((id) => readyRows.find((r) => r.dentist_id === id)?.ready !== false)
  const dayAppts = (await svc.from('appointments').select('dentist_id, scheduled_at, payment_status, status')
    .gte('scheduled_at', at(today, '00:00')).lt('scheduled_at', dayEnd)).data ?? []
  const reservedToday = dayAppts.filter((a) => ['pending', 'paid'].includes(a.payment_status) && a.status !== 'cancelled')
  const hourCount = reservedToday.filter((a) => manilaHour(a.scheduled_at) === hour).length
  const cnt = (id) => reservedToday.filter((a) => a.dentist_id === id).length

  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const opsC = await pg.locator(`[data-testid="ops-${C}"]`).innerText()
  const opsA = await pg.locator(`[data-testid="ops-${A}"]`).innerText()
  check('3c ops panel shows Ready dentist as Ready + scheduled hours + appt count',
    opsC.includes('Ready') && !opsC.includes('Not Ready') && opsC.includes('Scheduled 10:00–17:00') && opsC.includes(`${cnt(C)} appt`), opsC.replace(/\n/g, ' '))
  check('3d ops panel reflects dentist set Not Ready via API',
    opsA.includes('Not Ready') && opsA.includes(`${cnt(A)} appt`), opsA.replace(/\n/g, ' '))
  const cap = await pg.locator('[data-testid="capacity-line"]').innerText()
  check('3e capacity line: N scheduled · M Ready · K appointments today',
    cap === `${schedIds.length} scheduled · ${readyIds.length} Ready · ${reservedToday.length} appointments today`, cap)
  const warn = await pg.locator('[data-testid="conflict-warnings"]').innerText()
  check('4a hour-conflict warning appears when booked > ready',
    warn.includes(`${hourCount} appointments at ${hour}:00 but only ${readyIds.length} dentists Ready`), warn.replace(/\n/g, ' '))

  // ── (5) deactivated dentist with future appointments shows the warning ──────
  const off = await svc.from('dentists')
    .insert({ full_name: 'QA Deactivated DDS', email: OFF_EMAIL, role: 'doctor', active: true })
    .select('id').single()
  if (off.error) { console.error('FAIL cannot create dentist: ' + off.error.message); process.exit(1) }
  const OFF = off.data.id
  await svc.from('dentist_work_schedules').insert({ dentist_id: OFF, day_of_week: dow(D_TUE), open_time: '07:00', close_time: '08:00', active: true })
  const f1 = await book(andrea, D_TUE, '07:00', { dentist: OFF })
  check('5a future appointment on the new dentist booked', !f1.error, f1.error?.message)
  const deact = await svc.from('dentists').update({ active: false }).eq('id', OFF)
  check('5b dentist deactivated with future appointment still standing', !deact.error,
    deact.error?.message ?? `appt kept=${!!created.at(-1)}`)
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const warn2 = await pg.locator('[data-testid="conflict-warnings"]').innerText()
  check('5c deactivated-with-future-appointments warning displayed',
    warn2.includes('QA Deactivated DDS is deactivated but has 1 future appointment — reassign or cancel manually'), warn2.replace(/\n/g, ' '))

  // ── (6) doctor Ready toggle persists and never affects booking ──────────────
  await login('doctor@dentalvibe.ph')
  await pg.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const tog = pg.locator('[data-testid="ready-toggle"]')
  check('6a doctor Ready toggle present', await tog.count() === 1)
  await svc.from('dentist_ready').upsert({ dentist_id: C, clinic_date: today, ready: true }, { onConflict: 'dentist_id,clinic_date' })
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await tog.click(); await pg.waitForTimeout(1200)
  const rowAfter = (await svc.from('dentist_ready').select('ready').eq('dentist_id', C).eq('clinic_date', today)).data
  check('6b toggle click persists to dentist_ready', rowAfter?.length === 1 && rowAfter[0].ready === false, JSON.stringify(rowAfter))
  await tog.click(); await pg.waitForTimeout(1200)
  const rowBack = (await svc.from('dentist_ready').select('ready').eq('dentist_id', C).eq('clinic_date', today)).data
  check('6c toggle flips back', rowBack?.[0]?.ready === true, JSON.stringify(rowBack))
  // zero ready rows on a future date — booking must succeed regardless
  await svc.from('dentist_ready').delete().in('clinic_date', TEST_DATES)
  const dTueIds = (await daySchedule(D_TUE)).map((r) => r.dentist_id)
  const z1 = await book(carlo, D_TUE, '10:00')
  check('6d booking succeeds with zero ready rows (Ready never gates booking)',
    !z1.error && dTueIds.includes(z1.data?.[0]?.dentist_id), z1.error?.message ?? 'ok')

  // ── (6e) fresh-day state machine: NO ROW must show NOT READY (§1) ──────────
  await svc.from('dentist_ready').delete().eq('dentist_id', C).eq('clinic_date', today)
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  const btnFresh = (await tog.innerText()).trim()
  const headFresh = (await pg.locator('text=Today\'s presence').first().innerText()).trim()
  check('6e fresh day (no row) shows NOT READY + Ready action',
    btnFresh === 'Ready for Today' && /not ready/i.test(headFresh), 'btn=' + btnFresh + ' head=' + headFresh)
  await tog.click(); await pg.waitForTimeout(1200)
  const rowE = (await svc.from('dentist_ready').select('ready').eq('dentist_id', C).eq('clinic_date', today)).data
  check('6f click on fresh day SETS Ready (not false)', rowE?.[0]?.ready === true, JSON.stringify(rowE))
  check('6g Ready state shows Ready + Not Ready action',
    (await tog.innerText()).trim() === 'Not Ready' && /· ready$/i.test((await pg.locator('text=Today\'s presence').first().innerText()).trim()), await tog.innerText())
  await tog.click(); await pg.waitForTimeout(1200)
  const rowE2 = (await svc.from('dentist_ready').select('ready').eq('dentist_id', C).eq('clinic_date', today)).data
  check('6h second click sets Not Ready', rowE2?.[0]?.ready === false, JSON.stringify(rowE2))
  await svc.from('dentist_ready').delete().eq('dentist_id', C).eq('clinic_date', today)

  // ── (7) owner with no dentist row is never a resource ───────────────────────
  const u = await svc.auth.admin.createUser({ email: OWNER_EMAIL, password: 'password123', email_confirm: true })
  check('7a temp owner account created', !u.error, u.error?.message)
  if (!u.error) {
    await svc.from('profiles').update({ role: 'owner' }).eq('id', u.data.user.id)
    const noRow = (await svc.from('dentists').select('id').eq('email', OWNER_EMAIL)).data ?? []
    check('7b non-provider owner has no dentist row', noRow.length === 0)
    const ids = (await daySchedule(D_TUE)).map((r) => r.dentist_id)
    const real = (await svc.from('dentists').select('id')).data.map((r) => r.id)
    check('7c fn_day_schedule only returns real dentist ids', ids.length > 0 && ids.every((id) => real.includes(id)), ids.join())
    const b7 = await book(liza, D_TUE, '16:00')
    check('7d booking auto-assigns to a scheduled dentist, never a non-provider owner',
      !b7.error && ids.includes(b7.data?.[0]?.dentist_id), b7.error?.message ?? String(b7.data?.[0]?.dentist_id))
    await login(OWNER_EMAIL)
    await pg.goto(BASE + '/owner/schedules', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
    const note = await pg.locator('[data-testid="owner-note"]').innerText()
    check('7e UI states the non-provider owner is never a bookable resource',
      /no dentist row and no work schedule — you are never a bookable resource/.test(note), note)
    check('7f no Ready toggle for a non-provider owner', await pg.locator('[data-testid="ready-toggle"]').count() === 0)
    await delQaUser(OWNER_EMAIL)
  }
  await b.close()
}

// ── cleanup: every row this script created ────────────────────────────────────
{
  if (created.length) await svc.from('appointments').delete().in('id', created)
  await svc.from('dentist_work_schedules').delete().in('dentist_id', [A, B, C])
  if (preSched.length) await svc.from('dentist_work_schedules').insert(preSched)
  await svc.from('dentist_ready').delete().eq('clinic_date', today).in('dentist_id', ACTIVE)
  if (preReadyToday.length) await svc.from('dentist_ready').insert(preReadyToday)
  await svc.from('dentists').delete().eq('email', OFF_EMAIL) // cascade removes its schedule rows
  await delQaUser(OWNER_EMAIL)
  const leftA = await svc.from('appointments').select('id').in('id', created)
  const leftS = await svc.from('dentist_work_schedules').select('id').in('dentist_id', [A, B, C]).eq('day_of_week', 0)
  check('z1 all created rows cleaned up', !leftA.error && !leftS.error && !leftA.data.length && !leftS.data.length,
    `appts_left=${leftA.data?.length} sunday_rows_left=${leftS.data?.length}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
