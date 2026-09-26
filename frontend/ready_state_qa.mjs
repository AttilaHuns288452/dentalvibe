// ready_state_qa.mjs — dentist_ready is a DAY-OF presence signal (0030 model):
// it never gates or expands booking capacity (dentist_work_schedules does), it is
// read per clinic_date (nothing inherits across days), and a deactivated dentist
// can never become Ready. API/DB assertions against the live project via the
// service key (SB_SECRET) + doctor/owner/patient clients. All rows created here
// are removed (pre-existing Ready rows for real dentists are restored).
// Run (from frontend/): SB_SECRET=... node ready_state_qa.mjs
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
if (!process.env.SB_SECRET) { console.error('FAIL SB_SECRET env var missing'); process.exit(1) }
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const anon = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

const manilaDay = (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(d)
const TODAY = manilaDay(new Date())
const TOMORROW = manilaDay(new Date(Date.now() + 864e5)) // Manila has no DST
const at = (dateISO, hhmm) => `${dateISO}T${hhmm}:00+08:00`
const D_FUTURE = '2033-07-03' // far-future Sunday: nobody else is scheduled there

const authed = async (email) => {
  const c = anon()
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ' login failed: ' + error.message)
  return c
}
const doctorC = await authed('doctor@dentalvibe.ph') // Dr. Miguel Ramos
const ownerC = await authed('owner@dentalvibe.ph') // owner who IS a provider
const mariaC = await authed('maria@dentalvibe.ph')

const dent = (await svc.from('dentists').select('id, email, active')).data
const byEmail = Object.fromEntries(dent.map((d) => [d.email, d]))
const DOC = byEmail['doctor@dentalvibe.ph'].id
const DIAZ = byEmail['dr.diaz@email.com'].id
const OWND = byEmail['owner@dentalvibe.ph'].id // owner-as-provider has a dentists row
const OWN_UID = (await ownerC.auth.getUser()).data.user.id
const pats = (await svc.from('patients').select('id, full_name')).data
const byName = Object.fromEntries(pats.map((p) => [p.full_name, p.id]))
const svcRow = (await svc.from('services').select('id, price').eq('name', 'Consultation').single()).data

// snapshot real-dentist Ready rows we are about to touch — restored at cleanup
const TOUCH = [DOC, DIAZ, OWND]
const preRows = (await svc.from('dentist_ready').select('*')
  .in('dentist_id', TOUCH).in('clinic_date', [TODAY, TOMORROW])).data ?? []

// self-heal leftovers of a previous crashed run (our future date + our throwaways)
await svc.from('appointments').delete().eq('notes', 'ready_state_qa')
await svc.from('dentist_ready').delete().eq('clinic_date', D_FUTURE)
await svc.from('dentists').delete().like('email', 'qa-ready-%@qa.test')
await svc.from('profiles').delete().like('full_name', 'QA Non-Provider%')

const madeDentists = []
const mkDentist = async (tag, active = true) => {
  const r = await svc.from('dentists')
    .insert({ full_name: `QA Ready ${tag}`, email: `qa-ready-${tag}-${Date.now()}@qa.test`, role: 'doctor', active })
    .select('id').single()
  if (r.error) throw new Error('cannot create dentist: ' + r.error.message)
  madeDentists.push(r.data.id)
  return r.data.id
}
const upsertReady = (client, dentistId, dateISO, ready) =>
  client.from('dentist_ready').upsert(
    { dentist_id: dentistId, clinic_date: dateISO, ready, ready_at: ready ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
    { onConflict: 'dentist_id,clinic_date' })

// ── (1) doctor sets Ready for today (row upserted for the Manila clinic date) ─
{
  const r = await upsertReady(doctorC, DOC, TODAY, true)
  const row = (await svc.from('dentist_ready').select('*').eq('dentist_id', DOC).eq('clinic_date', TODAY)).data?.[0]
  check('r1 doctor sets Ready for today (row upserted for Manila clinic date)',
    !r.error && row?.clinic_date === TODAY && row?.ready === true && !!row?.ready_at,
    r.error?.message ?? JSON.stringify(row && { d: row.clinic_date, ready: row.ready }))
}

// ── (2) doctor sets Not Ready ─────────────────────────────────────────────────
{
  const r = await upsertReady(doctorC, DOC, TODAY, false)
  const row = (await svc.from('dentist_ready').select('*').eq('dentist_id', DOC).eq('clinic_date', TODAY)).data?.[0]
  check('r2 doctor sets Not Ready for today', !r.error && row?.ready === false, r.error?.message ?? JSON.stringify(row?.ready))
}

// ── (3) tomorrow does NOT inherit today's Ready (state is per clinic_date) ────
{
  await upsertReady(doctorC, DOC, TODAY, true) // Ready again today
  const t = (await svc.from('dentist_ready').select('*').eq('dentist_id', DOC).eq('clinic_date', TOMORROW)).data ?? []
  const today = (await svc.from('dentist_ready').select('*').eq('dentist_id', DOC).eq('clinic_date', TODAY)).data ?? []
  check('r3 tomorrow does not inherit today’s Ready (no row; state read per clinic_date)',
    t.length === 0 && today.length === 1 && today[0].ready === true,
    `tomorrow=${t.length} today=${today.length} ready=${today[0]?.ready}`)
}

// ── (4) deactivated doctor cannot become Ready (guard raises) ─────────────────
{
  const OFF = await mkDentist('off', false)
  const r = await upsertReady(svc, OFF, TODAY, true)
  check('r4 deactivated doctor cannot become Ready (guard raises)',
    !!r.error && /deactivated dentist cannot become ready/.test(r.error.message), r.error?.message ?? 'upsert succeeded')
}

// ── (5) Ready does not affect future booking (zero ready rows still book) ─────
{
  const T = await mkDentist('future')
  await svc.from('dentist_work_schedules').insert({ dentist_id: T, day_of_week: 0, open_time: '10:00', close_time: '17:00' })
  const sched = (await svc.rpc('fn_day_schedule', { p_date: D_FUTURE })).data ?? []
  check('r5a only the throwaway is scheduled on the future date', sched.length === 1 && sched[0].dentist_id === T,
    JSON.stringify(sched))
  const activeIds = dent.filter((d) => d.active).map((d) => d.id)
  const rows = [...new Set([...activeIds, T])].map((id) => ({ dentist_id: id, clinic_date: D_FUTURE, ready: false, updated_at: new Date().toISOString() }))
  const up = await svc.from('dentist_ready').upsert(rows, { onConflict: 'dentist_id,clinic_date' })
  const b = await svc.from('appointments').insert({
    patient_id: byName['Maria Santos'], service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D_FUTURE,
    scheduled_at: at(D_FUTURE, '10:00'), duration_minutes: 30, price: svcRow.price,
    status: 'pending', payment_status: 'pending', notes: 'ready_state_qa',
  }).select('id, dentist_id')
  if (!b.error && b.data?.[0]?.id) globalThis.__appt = b.data[0].id
  check('r5b booking succeeds with ready=false rows everywhere (Ready never gates booking)',
    !up.error && !b.error && b.data?.[0]?.dentist_id === T,
    up.error?.message ?? b.error?.message ?? 'insert succeeded')
}

// ── (6) Ready affects the day-of operational view only ────────────────────────
{
  const schedBefore = (await svc.rpc('fn_day_schedule', { p_date: TODAY })).data ?? []
  await upsertReady(doctorC, DOC, TODAY, true) // Ready
  await upsertReady(svc, DIAZ, TODAY, false) // Not Ready
  const schedAfter = (await svc.rpc('fn_day_schedule', { p_date: TODAY })).data ?? []
  const readyRows = (await svc.from('dentist_ready').select('dentist_id, ready').eq('clinic_date', TODAY).in('dentist_id', [DOC, DIAZ])).data ?? []
  const readyCount = readyRows.filter((r) => r.ready).length
  check('r6a Ready does not change the schedule: Not-Ready dentist still scheduled',
    schedAfter.length === schedBefore.length && schedAfter.some((s) => s.dentist_id === DIAZ),
    `before=${schedBefore.length} after=${schedAfter.length}`)
  check('r6b day-of ops view: ready count (1) vs scheduled count (2) for today',
    schedAfter.filter((s) => [DOC, DIAZ].includes(s.dentist_id)).length === 2 && readyCount === 1
      && readyRows.length === 2 && readyRows.some((r) => r.dentist_id === DOC && r.ready)
      && readyRows.some((r) => r.dentist_id === DIAZ && !r.ready),
    JSON.stringify({ readyCount, rows: readyRows, scheduled: schedAfter.length }))
}

// ── (7) owner-as-provider can use Ready ───────────────────────────────────────
{
  const r = await upsertReady(ownerC, OWND, TODAY, true)
  const row = (await svc.from('dentist_ready').select('*').eq('dentist_id', OWND).eq('clinic_date', TODAY)).data?.[0]
  check('r7 owner-as-provider (own dentists row) can use Ready',
    !r.error && row?.ready === true, r.error?.message ?? JSON.stringify(row?.ready))
}

// ── (8) non-provider owner is not a resource ──────────────────────────────────
const NP_EMAIL = `qa-ready-np-${Date.now()}@qa.test`
let NP_UID = null, NP_PROFILE = null
{
  const u = await svc.auth.admin.createUser({ email: NP_EMAIL, password: 'password123', email_confirm: true })
  NP_UID = u.data?.user?.id
  check('r8x setup: throwaway owner account created', !!NP_UID, u.error?.message)
  await svc.from('profiles').update({ role: 'owner', full_name: `QA Non-Provider ${Date.now()}` }).eq('id', NP_UID)
  NP_PROFILE = (await svc.from('profiles').select('id, role').eq('id', NP_UID).single()).data
  const np = await authed(NP_EMAIL)

  const d = (await svc.from('dentists').select('id').eq('email', NP_EMAIL)).data ?? []
  check('r8a non-provider owner has no dentists row (not a resource)', NP_PROFILE?.role === 'owner' && d.length === 0,
    JSON.stringify({ role: NP_PROFILE?.role, dentistRows: d.length }))

  // Ready writes are self (own dentist row) or owner only — a patient cannot flip anyone
  const r1 = await upsertReady(mariaC, DOC, TOMORROW, true)
  const t = (await svc.from('dentist_ready').select('id').eq('dentist_id', DOC).eq('clinic_date', TOMORROW)).data ?? []
  check('r8b Ready rows are self-or-owner only: patient write to another dentist denied',
    !!r1.error && t.length === 0, r1.error?.message ?? `rows=${t.length}`)

  // cannot become Ready for self (no dentist row → RLS denies the write)
  const r2 = await upsertReady(np, NP_PROFILE.id, TODAY, true)
  const self = (await svc.from('dentist_ready').select('id').eq('dentist_id', NP_PROFILE.id)).data ?? []
  check('r8c non-provider owner cannot upsert a Ready row for self', !!r2.error && self.length === 0,
    r2.error?.message ?? `rows=${self.length}`)

  // never assignable: a booking naming them as dentist is rejected
  const b = await svc.from('appointments').insert({
    patient_id: byName['Juan Dela Cruz'], service_id: svcRow.id, service_ids: [svcRow.id], requested_date: D_FUTURE,
    scheduled_at: at(D_FUTURE, '11:00'), duration_minutes: 30, price: svcRow.price,
    status: 'pending', payment_status: 'pending', notes: 'ready_state_qa', dentist_id: NP_PROFILE.id,
  })
  check('r8d non-provider owner is never assigned (booking naming them rejected)',
    !!b.error && /no dentist available/.test(b.error.message), b.error?.message ?? 'insert succeeded')
}

// ── cleanup: every row this script created (restore pre-existing Ready rows) ──
{
  if (globalThis.__appt) await svc.from('appointments').delete().eq('id', globalThis.__appt)
  await svc.from('dentist_ready').delete().in('dentist_id', TOUCH).in('clinic_date', [TODAY, TOMORROW])
  await svc.from('dentist_ready').delete().eq('clinic_date', D_FUTURE)
  if (preRows.length) await svc.from('dentist_ready').upsert(preRows, { onConflict: 'dentist_id,clinic_date' })
  await svc.from('dentists').delete().in('id', madeDentists) // cascades schedule + ready rows
  await svc.from('dentists').delete().like('email', 'qa-ready-%@qa.test')
  if (NP_UID) await svc.auth.admin.deleteUser(NP_UID)
  await svc.from('profiles').delete().like('full_name', 'QA Non-Provider%')

  const leftA = await svc.from('appointments').select('id').eq('notes', 'ready_state_qa')
  const leftF = await svc.from('dentist_ready').select('id').eq('clinic_date', D_FUTURE)
  const leftD = await svc.from('dentists').select('id').like('email', 'qa-ready-%@qa.test')
  const mine = (await svc.from('dentist_ready').select('id')
    .in('dentist_id', TOUCH).in('clinic_date', [TODAY, TOMORROW])).data ?? []
  check('z1 all created rows cleaned up (pre-existing Ready rows restored)',
    !leftA.error && !leftF.error && !leftD.error
      && !leftA.data.length && !leftF.data.length && !leftD.data.length
      && mine.length === preRows.length,
    `appts=${leftA.data?.length} future_ready=${leftF.data?.length} dentists=${leftD.data?.length} ready ${mine.length}/${preRows.length}`)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
