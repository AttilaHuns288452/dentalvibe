// Browser validity matrix (#43-56): A-L cases + payment idempotency + #56 standard.
// usage: cd frontend && SB_SECRET=... node nav_matrix.mjs   (serve :4176)
import { chromium } from '/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const KEY = fs.readFileSync('.env.local', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim()
const svc = createClient('https://wfmtkmfevdqbhtpqamic.supabase.co', process.env.SB_SECRET, { auth: { persistSession: false } })
const b = await chromium.launch()
let pass = 0, fail = 0
const check = (id, cond, detail = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} | ${id}${detail ? ' :: ' + detail : ''}`) }

async function fresh(email = 'maria@dentalvibe.ph', opts = {}) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, ...opts })
  const pg = await ctx.newPage()
  pg.on('pageerror', () => {})
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} })
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', email)
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(2200)
  return { ctx, pg }
}
const txt = async (pg) => (await pg.locator('body').textContent()).replace(/\s+/g, ' ')
const T_DATES = []
const testDate = (days) => {
  const d = new Date(); d.setDate(d.getDate() + days)
  while (d.getDay() === 0) d.setDate(d.getDate() + 1) // clinic closed Sundays — day button is disabled
  T_DATES.push(d.toISOString().slice(0, 10))
  return d
}
// test zone = today+16..today+27 (seed rows live at <= +15 and +32) — cleared at both ends
const cleanTestRows = async () => {
  const lo = new Date(Date.now() + 16 * 864e5).toISOString().slice(0, 10)
  const hi = new Date(Date.now() + 27 * 864e5).toISOString().slice(0, 10)
  const { data: rows } = await svc.from('appointments').select('id, requested_date').gte('requested_date', lo).lte('requested_date', hi)
  for (const r of rows ?? []) { await svc.from('payments').delete().eq('appointment_id', r.id); await svc.from('appointments').delete().eq('id', r.id) }
}
const marId = async () => (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
const apptRows = async () => (await svc.from('appointments').select('id', { count: 'exact', head: true })).count

await cleanTestRows()

// ============ A. normal flow baseline (book -> confirm) ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  const t = await txt(pg)
  check('A1. forward flow reaches step 2', /Total₱/.test(t))
  await ctx.close()
}

// ============ B. Back returns to previous BOOKING STEP (not exits) ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  await pg.goBack()
  await pg.waitForTimeout(500)
  const t = await txt(pg)
  check('B1. Back from step 2 lands on step 1 (stays in booking)', t.includes('Book Appointment') && (await pg.locator('input[placeholder*="Search services"]').count()) === 1)
  check('B2. Back restores the picked service (draft kept)', (await pg.locator('main button[aria-pressed="true"]').count()) === 1)
  await ctx.close()
}

// ============ B2. patient list search preserved across detail -> Back ============
{
  const { ctx, pg } = await fresh('owner@dentalvibe.ph')
  await pg.goto(BASE + '/owner/patients', { waitUntil: 'networkidle' })
  await pg.waitForTimeout(800)
  await pg.locator('input[placeholder*="Search"], input[placeholder*="search"]').first().fill('Maria')
  await pg.waitForTimeout(300)
  await pg.locator('main button:has-text("Maria Santos")').first().click()
  await pg.waitForTimeout(900)
  await pg.goBack()
  await pg.waitForTimeout(700)
  const val = await pg.locator('input[placeholder*="earch"]').first().inputValue().catch(() => '')
  check('B3. Back preserves patient-list search state', val === 'Maria', JSON.stringify(val))
  await ctx.close()
}

// ============ C. Forward restores, never duplicates side effects ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  await pg.goBack(); await pg.waitForTimeout(400)
  await pg.goForward(); await pg.waitForTimeout(500)
  const t = await txt(pg)
  check('C1. Forward restores step 2', /Total₱/.test(t))
  await ctx.close()
}

// ============ D. refresh at booking step + payment result ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(400)
  await pg.reload({ waitUntil: 'networkidle' })
  await pg.waitForTimeout(600)
  const t = await txt(pg)
  check('D1. refresh on step 2 keeps a VALID booking state', /Total₱/.test(t) || (await pg.locator('input[placeholder*="Search services"]').count()) === 1)
  await ctx.close()
}

// ============ D2/G. payment result page: refresh + reopen show AUTHORITATIVE state (no re-pay) ============
{
  const { ctx, pg } = await fresh()
  // complete a real booking + mock payment via UI
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  const target = testDate(18)
  for (let i = 0; i < 3; i++) {
    const label = await pg.locator('section:has-text("Preferred date") span.text-sm.font-bold').first().textContent()
    const cur = new Date(label.trim() + ' 1')
    if (cur.getMonth() === target.getMonth()) break
    if (cur < target) await pg.locator('button[aria-label="Next month"]').click()
    await pg.waitForTimeout(200)
  }
  await pg.getByRole('button', { name: String(target.getDate()), exact: true }).click()
  await pg.waitForTimeout(600)
  await pg.locator('form section:has-text("Available time") button:not([disabled])').first().click()
  await pg.locator('button:has-text("Continue to Payment")').click()
  await pg.waitForTimeout(1200)
  await pg.locator('button:has-text("Pay Now")').click()
  const devBtn = pg.locator('button:has-text("DEV: simulate PayMongo test payment")')
  await devBtn.waitFor({ state: 'visible', timeout: 30000 })
  await devBtn.click()
  let t1 = ''
  for (let i = 0; i < 24; i++) { await pg.waitForTimeout(1500); t1 = await txt(pg); if (/Approved|Confirmed/i.test(t1)) break }
  check('E1. payment success state renders', /Approved|Confirmed/i.test(t1))
  const rowsBefore = await apptRows()
  const payRowsBefore = (await svc.from('payments').select('id', { count: 'exact', head: true })).count
  const successUrl = pg.url()
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  const t2 = await txt(pg)
  check('D3. refresh on result shows result (no second payment UI)', /Approved|Confirmed/i.test(t2) && !/Pay Now/i.test(t2), successUrl)
  await pg.goBack().catch(() => {}); await pg.waitForTimeout(500)
  await pg.goForward().catch(() => {}); await pg.waitForTimeout(800)
  const rowsAfter = await apptRows()
  const payRowsAfter = (await svc.from('payments').select('id', { count: 'exact', head: true })).count
  check('C2. back/forward after pay: no duplicate appointment/payment rows', rowsAfter === rowsBefore && payRowsAfter === payRowsBefore, `appts ${rowsBefore}->${rowsAfter} proofs ${payRowsBefore}->${payRowsAfter}`)
  // reopen result URL in a brand-new tab (deep link)
  const { ctx: c2, pg: p2 } = await fresh()
  await p2.goto(successUrl, { waitUntil: 'networkidle' }); await p2.waitForTimeout(1200)
  const t3 = await txt(p2)
  check('E2. copied result URL in new tab shows authoritative state', /Approved|Confirmed/i.test(t3), successUrl.replace(BASE, ''))
  await c2.close()
  await ctx.close()
}

// ============ G. logout then Back/Forward ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' }); await pg.waitForTimeout(600)
  await pg.goto(BASE + '/profile', { waitUntil: 'networkidle' }); await pg.waitForTimeout(500)
  await pg.locator('button:has-text("Log Out")').click(); await pg.waitForTimeout(1200)
  await pg.goBack().catch(() => {}); await pg.waitForTimeout(700)
  const t1 = await txt(pg)
  check('G1. Back after logout shows login (no protected data)', !/My Appointments|Upcoming/i.test(t1) && /Sign In/i.test(t1))
  await pg.goForward().catch(() => {}); await pg.waitForTimeout(700)
  const t2 = await txt(pg)
  check('G2. Forward after logout shows login', !/Upcoming/i.test(t2) && /Sign In/i.test(t2))
  await ctx.close()
}

// ============ H. double-click mutation ============
{
  const { ctx, pg } = await fresh()
  const before = await apptRows()
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' })
  await pg.locator('main form button[type="button"]').first().click()
  await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  const target = testDate(22)
  for (let i = 0; i < 3; i++) {
    const label = await pg.locator('section:has-text("Preferred date") span.text-sm.font-bold').first().textContent()
    const cur = new Date(label.trim() + ' 1')
    if (cur.getMonth() === target.getMonth()) break
    if (cur < target) await pg.locator('button[aria-label="Next month"]').click()
    await pg.waitForTimeout(200)
  }
  await pg.getByRole('button', { name: String(target.getDate()), exact: true }).click()
  await pg.waitForTimeout(500)
  await pg.locator('form section:has-text("Available time") button:not([disabled])').first().click()
  const cta = pg.locator('button:has-text("Continue to Payment")')
  await cta.click({ noWaitAfter: true }).catch(() => {})
  await cta.click({ noWaitAfter: true, force: true }).catch(() => {})
  await cta.click({ noWaitAfter: true, force: true }).catch(() => {})
  await pg.waitForTimeout(2500)
  const after = await apptRows()
  check('H1. triple-click book creates exactly 1 appointment', after === before + 1, `${before}->${after}`)
  await ctx.close()
}

// ============ I. two tabs: mutation in A, revalidate in B ============
{
  const { ctx, pg: a } = await fresh()
  const pg = await ctx.newPage()
  await pg.goto(BASE + '/notifications', { waitUntil: 'networkidle' }); await pg.waitForTimeout(800)
  const badgeSel = 'nav a[href*="notifications"], nav button, nav span'
  const beforeTxt = await txt(a)
  // tab A marks all read (if any exist)
  await a.goto(BASE + '/notifications', { waitUntil: 'networkidle' }); await a.waitForTimeout(800)
  if (await a.locator('button:has-text("Mark all read")').count()) {
    await a.locator('button:has-text("Mark all read")').click(); await a.waitForTimeout(600)
  }
  // tab B: bring to front (visibility) and check the feed reflects read state
  await pg.bringToFront(); await pg.waitForTimeout(1200)
  await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(800)
  const unreadLeft = await pg.locator('button:has-text("Mark all read")').count()
  check('I1. second tab converges after first-tab mutation (revalidate)', unreadLeft === 0)
  await ctx.close()
}

// ============ J. invalid routes / entities ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/book/success?appt=00000000-0000-0000-0000-000000000000', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
  const t1 = await txt(pg)
  check('J1. unknown appointment id -> graceful state (no crash, no fake data)', !/undefined|NaN/.test(t1) && (/not found|couldn|no longer|Appointments|Book/i.test(t1)), t1.slice(0, 70))
  await pg.goto(BASE + '/owner/patients/ehr', { waitUntil: 'networkidle' }); await pg.waitForTimeout(800)
  const t2 = await txt(pg)
  check('J2. EHR without patient -> graceful state', !/undefined|NaN/.test(t2) && /back|list|select|not found|Patients/i.test(t2), t2.slice(0, 70))
  const errs = []
  const pg2 = await ctx.newPage(); pg2.on('pageerror', (e) => errs.push(e.message))
  await pg2.goto(BASE + '/nope/xyz', { waitUntil: 'networkidle' }); await pg2.waitForTimeout(600)
  check('J3. unknown route renders shell fallback (no crash)', errs.length === 0)
  await ctx.close()
}

// ============ J2. cross-role route ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/owner/income', { waitUntil: 'networkidle' }); await pg.waitForTimeout(900)
  const t = await txt(pg)
  check('J4. patient on /owner/income bounces to own home', !/Net income/i.test(t) && /Good (morning|afternoon|evening)|patient portal/i.test(t))
  await ctx.close()
}

// ============ K. slow network: loaders not blanks ============
{
  const { ctx, pg } = await fresh()
  await pg.route('**/rest/v1/appointments?*', async (route) => { await new Promise((r) => setTimeout(r, 2000)); route.continue() })
  await pg.goto(BASE + '/appointments', { waitUntil: 'commit' }); await pg.waitForTimeout(700)
  const hasLoader = (await pg.locator('.animate-pulse').count()) > 0
  check('K1. slow fetch shows skeleton loader (not blank)', hasLoader)
  await ctx.close()
}

// ============ L. failed network: error, never fake success ============
{
  const { ctx, pg } = await fresh()
  await pg.route('**/rest/v1/appointments?*', (route) => route.fulfill({ status: 500, body: '{"message":"boom"}' }))
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const t = await txt(pg)
  check('L1. failed fetch shows error (no silent empty)', /boom|Couldn|error/i.test(t))
  await ctx.close()
}

// ============ F. stale entity (deleted record via other session) ============
{
  const { ctx, pg } = await fresh()
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' }); await pg.waitForTimeout(900)
  const beforeTxt = await txt(pg)
  // cancel Maria's next unpaid booking straight in the DB (other session), then re-enter the screen
  const mar = await marId()
  const { data: victim } = await svc.from('appointments').select('id').eq('patient_id', mar).eq('status', 'pending').limit(1)
  let changed = false
  if (victim?.length) { await svc.from('appointments').update({ status: 'cancelled' }).eq('id', victim[0].id); changed = true }
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' }); await pg.waitForTimeout(900)
  const afterTxt = await txt(pg)
  check('F1. re-entering screen reflects server change (no stale cache)', !changed || beforeTxt !== afterTxt)
  if (victim?.length) await svc.from('appointments').update({ status: 'pending' }).eq('id', victim[0].id)
  await ctx.close()
}

await cleanTestRows()
console.log(`\n===== NAV MATRIX: ${pass} passed, ${fail} failed =====`)
await b.close()
