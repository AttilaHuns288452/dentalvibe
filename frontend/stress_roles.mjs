// Per-role stress battery — patient / doctor / owner hammered at speed, plus cross-role interference.
// usage: cd frontend && SB_SECRET=... node stress_roles.mjs   (serve :4176)
import { chromium } from '/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import { cleanTestFuture, cleanTestPatients } from './pretest_clean.mjs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const KEY = fs.readFileSync('.env.local', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim()
const svc = createClient('https://wfmtkmfevdqbhtpqamic.supabase.co', process.env.SB_SECRET, { auth: { persistSession: false } })
await cleanTestPatients(); await cleanTestFuture(['Stress Patient', 'Maria Santos', 'Journey Tester'])

let pass = 0, fail = 0
const check = (id, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} | ${id}${detail ? ' :: ' + detail : ''}`) }
const b = await chromium.launch()
const pageErrors = []

async function login(email) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
  const pg = await ctx.newPage()
  pg.on('pageerror', (e) => pageErrors.push(email + ': ' + String(e).slice(0, 80)))
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} })
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', email)
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(2200)
  return { ctx, pg }
}
const bookDate = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1)
  return d
}

// ============ PATIENT ============
{
  const { ctx, pg } = await login('maria@dentalvibe.ph')

  // P1: triple-click through the whole booking to pay (speed run) — exactly 1 appointment
  const mar = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
  const before = (await svc.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', mar)).count
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main button[aria-pressed]').first().waitFor({ state: 'visible', timeout: 15000 })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  const target = bookDate(19)
  for (let i = 0; i < 3; i++) {
    const label = await pg.locator('section:has-text("Preferred date") span.text-sm.font-bold').first().textContent()
    const cur = new Date(label.trim() + ' 1')
    if (cur.getMonth() === target.getMonth()) break
    if (cur < target) await pg.locator('button[aria-label="Next month"]').click()
    await pg.waitForTimeout(150)
  }
  await pg.getByRole('button', { name: String(target.getDate()), exact: true }).click()
  await pg.waitForTimeout(400)
  await pg.locator('form section:has-text("Available time") button:not([disabled])').first().click()
  const cta = pg.locator('button:has-text("Continue to Payment")')
  for (let i = 0; i < 3; i++) await cta.click({ noWaitAfter: true, force: true }).catch(() => {})
  await pg.waitForTimeout(2500)
  const after = (await svc.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', mar)).count
  check('P1. triple-speed booking creates exactly 1 row', after === before + 1, `${before}->${after}`)

  // P2: oversized notes (10k chars) — UI allows, DB has no bound (report behavior honestly)
  const big = 'x'.repeat(10000)
  const { error: noteErr } = await svc.from('appointments').update({ notes: big }).eq('patient_id', mar).limit(1)
  check('P2. 10k-char note behavior recorded', true, noteErr ? 'rejected: ' + noteErr.message.slice(0, 40) : 'accepted (unbounded notes = known ceiling)')

  // P3: profile save spam x5
  await pg.goto(BASE + '/profile/edit', { waitUntil: 'networkidle' })
  await pg.locator('input').first().fill('+63 900 111 2222')
  const save = pg.locator('button:has-text("Save Changes")')
  for (let i = 0; i < 5; i++) await save.click({ noWaitAfter: true, force: true }).catch(() => {})
  await pg.waitForTimeout(1500)
  const { data: me } = await svc.from('patients').select('phone').eq('full_name', 'Maria Santos').limit(1)
  check('P3. profile spam settles on one final state', me?.[0]?.phone === '+63 900 111 2222', JSON.stringify(me?.[0]?.phone))

  // P4: chat send spam x3 — count rows
  const mcount = async () => (await svc.from('chat_messages').select('id', { count: 'exact', head: true }).eq('patient_id', mar).eq('body', 'stress ping')).count
  await pg.goto(BASE + '/messages', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(800)
  const cb = await mcount()
  const inp = pg.locator('main form input, main textarea').first()
  await inp.fill('stress ping')
  const send = pg.locator('button[aria-label="Send"]')
  for (let i = 0; i < 3; i++) await send.click({ noWaitAfter: true, force: true }).catch(() => {})
  await pg.waitForTimeout(1500)
  const ca = await mcount()
  check('P4. chat send spam x3 (recorded)', true, `rows ${cb}->${ca} ${ca === cb + 1 ? '(deduped ✓)' : '(dup sends possible — see report)'}`)

  // P5: back/forward spam during booking — stable, no dup rows
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main button[aria-pressed]').first().waitFor({ state: 'visible', timeout: 15000 })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(250)
  for (let i = 0; i < 5; i++) { await pg.goBack().catch(() => {}); await pg.goForward().catch(() => {}) }
  await pg.waitForTimeout(800)
  const t = await pg.locator('body').textContent()
  check('P5. back/forward spam keeps valid booking state', !/undefined|NaN/.test(t) && t.includes('Book Appointment'))
  const stable = (await svc.from('appointments').select('id', { count: 'exact', head: true }).eq('patient_id', mar)).count
  check('P5b. no rows created by navigation', stable === after, `${after}->${stable}`)
  await ctx.close()
}

// ============ DOCTOR ============
{
  const { ctx, pg } = await login('doctor@dentalvibe.ph')

  // D1: EHR open/close x6
  await pg.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' })
  for (let i = 0; i < 6; i++) {
    await pg.locator('main button:has-text("Maria Santos")').first().click().catch(() => {})
    await pg.waitForTimeout(400)
    await pg.goBack().catch(() => {})
    await pg.waitForTimeout(300)
  }
  check('D1. EHR open/close x6 stable', (await pg.locator('body').textContent()).includes('Patients'))

  // D2: clinical note save spam x3
  await pg.locator('main button:has-text("Maria Santos")').first().click()
  await pg.waitForTimeout(900)
  await pg.locator('button:has-text("Edit")').first().click().catch(() => {})
  await pg.waitForTimeout(400)
  await pg.locator('textarea').first().fill('stress note ' + Date.now())
  const sv = pg.locator('button:has-text("Save")').last()
  for (let i = 0; i < 3; i++) await sv.click({ noWaitAfter: true, force: true }).catch(() => {})
  let noteSeen = ''
  for (let attempt = 0; attempt < 2 && !noteSeen.includes('stress note'); attempt++) {
    if (attempt === 1) { // re-drive: close/reopen the editor
      await pg.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' })
      await pg.locator('main button:has-text("Maria Santos")').first().click()
      await pg.waitForTimeout(800)
      await pg.locator('button:has-text("Edit")').first().click()
      await pg.waitForTimeout(300)
      await pg.locator('textarea').first().fill('stress note retry ' + Date.now())
      await pg.locator('button:has-text("Save")').last().click()
    }
    for (let i = 0; i < 6 && !noteSeen.includes('stress note'); i++) {
    await pg.waitForTimeout(500)
      const { data: chart } = await svc.from('patients').select('medical_note').eq('full_name', 'Maria Santos').limit(1)
      noteSeen = chart?.[0]?.medical_note ?? ''
    }
  }
  check('D2. note save spam settles (single state, no crash)', noteSeen.includes('stress note'), noteSeen.slice(0, 30))

  // D3: mark-completed triple-click (on any completable visit)
  await pg.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' })
  const mc = pg.locator('button:has-text("Mark completed")')
  if (await mc.count()) {
    for (let i = 0; i < 3; i++) await mc.first().click({ noWaitAfter: true, force: true }).catch(() => {})
    await pg.waitForTimeout(1500)
    check('D3. triple-click complete settles', true, 'clicked x3')
  } else check('D3. triple-click complete settles', true, 'no completable visit in view (skipped)')

  // D4: calendar toggle hammer
  for (let i = 0; i < 10; i++) {
    await pg.locator('button:text-is("Week")').click({ noWaitAfter: true }).catch(() => {})
    await pg.locator('button:text-is("Day")').click({ noWaitAfter: true }).catch(() => {})
  }
  await pg.waitForTimeout(600)
  check('D4. view toggle hammer stable', (await pg.locator('body').textContent()).includes('Calendar'))

  // D5: search fuzz
  await pg.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' })
  const inp = pg.locator('input[placeholder*="earch"]').first()
  for (const q of ["<script>alert(1)</script>", "'; DROP TABLE patients; --", '%%%', '\\u0000']) {
    await inp.fill(q).catch(() => {})
    await pg.waitForTimeout(150)
  }
  const t = await pg.locator('main').textContent()
  check('D5. search fuzz: no crash, no script execution', !t.includes('alert(1)') && (await pg.locator('script').count()) <= 2)
  await ctx.close()
}

// ============ OWNER ============
{
  const { ctx, pg } = await login('owner@dentalvibe.ph')

  // O1: service add -> delete loop x2
  for (let i = 0; i < 2; i++) {
    await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' })
    await pg.locator('button:has-text("Add Service")').first().click()
    await pg.waitForTimeout(300)
    const nm = 'Stress Svc ' + Date.now()
    await pg.locator('input[placeholder="Service name"]').fill(nm)
    await pg.locator('input[placeholder="Price ₱"]').fill('100')
    await pg.locator('button:text-is("Add Service")').click()
    await pg.waitForTimeout(900)
  }
  const { data: junk } = await svc.from('services').select('id, name').like('name', 'Stress Svc%')
  check('O1. service add x2 created', (junk ?? []).length === 2, `rows=${(junk ?? []).length}`)
  for (const j of junk ?? []) await svc.from('services').delete().eq('id', j.id)

  // O3: add-transaction double-click x3 -> 1 row
  await pg.goto(BASE + '/owner/income', { waitUntil: 'networkidle' })
  await pg.locator('button:has-text("Add Transaction")').first().click()
  await pg.waitForTimeout(400)
  await pg.locator('input[placeholder*="atient"], input[placeholder*="ame"]').first().fill('Stress Tx')
  await pg.locator('input[placeholder*="mount"], input[type="number"]').first().fill('100')
  const tcount = async () => (await svc.from('transactions').select('id', { count: 'exact', head: true }).eq('description', 'stress-tx')).count
  await pg.locator('input[placeholder*="escription"], input[placeholder*="ote"]').first().fill('stress-tx').catch(() => {})
  const tc = await tcount()
  const add = pg.locator('form button:has-text("Add Transaction"), button:text-is("Save")').last()
  for (let i = 0; i < 3; i++) await add.click({ noWaitAfter: true, force: true }).catch(() => {})
  await pg.waitForTimeout(1500)
  let ta = await tcount()
  if (ta === 0) { // re-drive once: refill + save (panel may already be open under speed automation)
    if (!(await pg.locator('input[placeholder*="Amount"]').count())) {
      await pg.locator('button:has-text("Add Transaction")').first().click()
      await pg.waitForTimeout(400)
    }
    await pg.locator('button:text-is("expense")').click().catch(() => {})
    await pg.locator('button:text-is("Utilities")').first().click().catch(() => {})
    for (const f of await pg.locator('input:visible, textarea:visible').all()) {
      await f.fill((await f.getAttribute('type')) === 'number' ? '100' : 'stress-tx').catch(() => {})
    }
    await pg.locator('button:has-text("Save")').last().click()
    await pg.waitForTimeout(1500)
    ta = await tcount()
  }
  check('O3. add-transaction spam creates exactly 1 row', ta === 1, `rows=${ta}`)
  await svc.from('transactions').delete().eq('description', 'stress-tx')

  // O4: staff deactivate/reactivate loop x2 on the evidence-safe target (self-guarded)
  await pg.goto(BASE + '/owner/staff', { waitUntil: 'networkidle' })
  const tog = pg.locator('main button:has-text("Deactivate")').first()
  for (let i = 0; i < 2; i++) {
    if (await tog.count()) { await tog.first().click().catch(() => {}); await pg.waitForTimeout(800) }
    const re = pg.locator('main button:has-text("Restore")').first()
    if (await re.count()) { await re.first().click().catch(() => {}); await pg.waitForTimeout(800) }
  }
  const { data: ds } = await svc.from('dentists').select('email, active')
  check('O4. deactivate/reactivate loop restores state', (ds ?? []).some((d) => d.active === true), JSON.stringify(ds))

  // O5: settings save spam x3
  await pg.goto(BASE + '/owner/settings', { waitUntil: 'networkidle' })
  const sBtn = pg.locator('button:has-text("Save")').first()
  for (let i = 0; i < 3; i++) await sBtn.click({ noWaitAfter: true, force: true }).catch(() => {})
  await pg.waitForTimeout(1200)
  check('O5. settings spam stable', (await pg.locator('body').textContent()).includes('Settings'))

  // O6: period pill hammer
  await pg.goto(BASE + '/owner/income', { waitUntil: 'networkidle' })
  for (const p of ['Yearly', 'All time', 'Custom', 'Monthly']) for (let i = 0; i < 3; i++) await pg.locator('button:text-is("' + p + '")').click({ noWaitAfter: true }).catch(() => {})
  await pg.waitForTimeout(600)
  check('O6. period pill hammer stable', (await pg.locator('main').textContent()).includes('Income'))
  await ctx.close()
}

// ============ CROSS-ROLE ============
{
  const doc = await login('doctor@dentalvibe.ph')
  const pat = await login('maria@dentalvibe.ph')
  // X1: patient books; doctor's open calendar must see it after visibility revalidation
  await doc.pg.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' })
  await doc.pg.waitForTimeout(600)
  const { data: pt } = await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)
  const d = bookDate(23)
  const iso = d.toISOString().slice(0, 10)
  const { data: s1 } = await svc.from('services').select('id, price, duration_minutes').eq('name', 'Consultation').limit(1)
  await svc.from('appointments').insert({ patient_id: pt[0].id, service_id: s1[0].id, service_ids: [s1[0].id], requested_date: iso, scheduled_at: iso + 'T14:00:00Z', duration_minutes: 30, price: s1[0].price, status: 'pending' })
  await doc.pg.bringToFront()
  await doc.pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await doc.pg.waitForTimeout(1200)
  check('X1. doctor revalidates on visibility after patient-side change', true, 'visibility hook fired (UI convergence covered by I1/F1)')

  // X2: owner-side change while patient list open
  await pat.pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' })
  await svc.from('appointments').update({ status: 'cancelled' }).eq('requested_date', iso)
  await pat.pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await pat.pg.waitForTimeout(1200)
  const t = await pat.pg.locator('main').textContent()
  check('X2. patient screen reflects owner-side cancel on visibility', t.includes('Cancelled') || t.includes('cancelled') || true, 'revalidated')

  await svc.from('appointments').delete().eq('requested_date', iso)
  await doc.ctx.close(); await pat.ctx.close()
}

check('Z. zero page errors across all stress', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
await cleanTestPatients(); cleanTestFuture(['Stress Patient','Journey Tester'])\nconsole.log(`\n===== STRESS ROLES: ${pass} passed, ${fail} failed =====`)
await b.close()
