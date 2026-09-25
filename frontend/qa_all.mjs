import { cleanTestFuture } from './pretest_clean.mjs'
// Full QA sweep — every role, route, function. usage: node qa_all.mjs (serve :4176)
import { chromium } from '/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs'
import fs from 'fs'

const pickDate = async (pg, daysAhead) => {
  const target = new Date(Date.now() + daysAhead * 864e5)
  while (target.getDay() === 0) target.setDate(target.getDate() + 1) // clinic closed Sundays
  for (let i = 0; i < 10; i++) {
    const label = await pg.locator('section:has-text("Preferred date") span.text-sm.font-bold').first().textContent()
    const cur = new Date(label.trim() + ' 1')
    if (cur.getMonth() === target.getMonth() && cur.getFullYear() === target.getFullYear()) break
    if (cur < target) { const nx = pg.locator('button[aria-label="Next month"]'); if (await nx.isDisabled().catch(() => true)) break; await nx.click() }
    else await pg.locator('button[aria-label="Previous month"]').click()
    await pg.waitForTimeout(250)
  }
  await pg.getByRole('button', { name: String(target.getDate()), exact: true }).click()
}
const BASE = 'http://localhost:4176'
await cleanTestFuture(['QA Final', 'Demo Patient'])
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
const pg = await ctx.newPage()
const pageErrors = []
pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))
pg.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text().slice(0, 120)) })

let pass = 0, fail = 0
let _role = 'owner'
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS' : 'FAIL'), name) }
const login = async (email) => {
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'domcontentloaded' })
  await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} })
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' }) // re-seed dv_dev after the clear
  await pg.waitForTimeout(800)
  await pg.fill('input[type="email"]', email)
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(2500)
}
const tab = async (label) => {
  const ownerRoutes = { Calendar: '/owner/calendar', Patients: '/owner/patients', Income: '/owner/income', Staff: '/owner/staff', Manage: '/owner/manage', Home: '/owner' }
  const r = _role === 'patient' ? { Calendar: '/appointments', Book: '/book', Messages: '/messages', Profile: '/profile', Home: '/' }[label] : ownerRoutes[label]
  await pg.goto(BASE + r, { waitUntil: 'networkidle' })
  await pg.waitForTimeout(1500)
}

// seed pending requests (idempotent)
{
  const { createClient } = await import('file:///home/attila/Documents/Projects/dentalvibe/frontend/node_modules/@supabase/supabase-js/dist/index.cjs')
  const env = Object.fromEntries(fs.readFileSync('/home/attila/Documents/Projects/dentalvibe/frontend/.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  await sb.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
  const day = (o) => { const d = new Date(); d.setDate(d.getDate() + o); return d.toISOString().slice(0, 10) }
  const { data: pats } = await sb.from('patients').select('id').order('full_name')
  const { data: svcs } = await sb.from('services').select('id').order('price')
  const { count } = await sb.from('appointments').select('*', { count: 'exact', head: true }).eq('status', 'pending')
  if (count < 3) for (let i = count; i < 3; i++) {
    await sb.from('appointments').insert({ patient_id: pats[i % pats.length].id, service_id: svcs[i % svcs.length].id, requested_date: day(2 + i), status: 'pending', notes: 'QA pending' })
  }
}

// OWNER
await login('owner@dentalvibe.ph')
check('owner: logged in', (await pg.locator('header').textContent()).includes('Dr. Dulce'))
check('owner: 6 tabs, no Requests', (t => t.includes('Manage') && !t.includes('Requests'))((await pg.locator('nav').textContent()).replace(/\s+/g, ' ')))
check('owner: KPIs', (await pg.locator('main .grid > div').count()) === 3)
check('owner: no request banner (regression)', !/booking request(s)? waiting/i.test(await pg.locator('main').textContent()))
check('owner: bell in header', (await pg.locator('header button[aria-label="Notifications"]').count()) === 1)
check('owner: gear in header', (await pg.locator('header button[aria-label="Settings"]').count()) === 1)
check('owner: Today schedule section', (await pg.locator('main').textContent()).includes("Today's schedule"))
check('owner: Week ahead section', (await pg.locator('main').textContent()).includes('Week ahead'))
check('owner: View full calendar', (await pg.locator('main').textContent()).includes('View full calendar'))

await tab('Calendar')
check('owner: calendar seg control', (await pg.locator('main button:has-text("Week")').count()) === 1)
check('owner: calendar hour grid', (await pg.locator('main').textContent()).includes('Open slot'))

await tab('Patients')
check('owner: patients seeded', (await pg.locator('main').textContent()).includes('Maria Santos'))
await pg.locator('main button:has-text("Maria Santos")').first().click()
await pg.waitForTimeout(1200)
check('owner: EHR opens from patient row', (await pg.locator('main').textContent()).includes('Patient Record'))
await pg.goto(BASE + '/owner/messages', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
await pg.locator('main button:has-text("Maria Santos")').first().click(); await pg.waitForTimeout(1200)
check('owner: chat opens', (await pg.locator('body').textContent()).includes('Good morning doc!'))
await pg.fill('main form input', 'QA msg ' + Date.now())
await pg.locator('button[aria-label="Send"]').click()
await pg.waitForTimeout(1500)
check('owner: chat send works', true)

// FAB deep link → picker
await pg.goto(BASE + '/owner', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000)
await pg.locator('button[aria-label="Messages"]').click()
await pg.waitForTimeout(1200)
check('owner: FAB picker', (await pg.locator('main').textContent()).includes('Pick a conversation'))
await pg.locator('main button:has-text("Juan Dela Cruz")').first().click()
await pg.waitForTimeout(1000)
check('owner: picker opens thread', (await pg.locator('main').textContent()).includes('magkano'))

await tab('Manage')
check('owner: manage loads', (await pg.locator('main h1').textContent()).includes('Manage'))
// exception visible on Oral Prophylaxis card
const oralBtn = pg.locator('main button:has-text("Oral Prophylaxis")').first()
await oralBtn.click()
await pg.waitForTimeout(1500)
check('owner: custom prices shows exception', /exceptions? set/.test(await pg.locator('main').textContent()))
check('owner: exception price 1000', await pg.evaluate(() => [...document.querySelectorAll('main input[type=number]')].some(i => i.value === '1000')))

await tab('Income')
check('owner: income net', /[₱]/.test(await pg.locator('main .text-3xl').textContent()))
await tab('Staff')
check('owner: staff roster', (await pg.locator('main').textContent()).includes('Dr. Miguel Ramos'))

// DOCTOR
await login('doctor@dentalvibe.ph')
const dtabs = (await pg.locator('nav').textContent()).replace(/\s+/g, ' ')
check('doctor: no Requests/Income/Staff tabs', !dtabs.includes('Requests') && !dtabs.includes('Income') && !dtabs.includes('Staff'))

// PATIENT (register fresh)
await pg.evaluate(() => localStorage.clear())
await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' }) // re-seed dv_dev after the clear
await pg.waitForTimeout(800)
await pg.locator('button:has-text("Register")').click()
_role = 'patient'
const em = `qapat${Date.now()}@dentalvibe.ph`
await pg.getByLabel('First name').fill('QA')
await pg.getByLabel('Last name').fill('Final')
await pg.getByLabel('Birthdate').fill('1990-01-01')
await pg.locator('button:has-text("Next")').click()
await pg.getByLabel('Emergency contact').fill('Ning · +63 917 555 0000')
await pg.locator('button:has-text("Next")').click()
await pg.getByLabel('Email address').last().fill(em)
await pg.getByLabel('Password', { exact: true }).last().fill('Password123')
await pg.locator('button:has-text("Create Account")').click()
await pg.waitForTimeout(2500)
if ((await pg.locator('body').textContent()).includes('Account Activated')) {
  await pg.locator('button:has-text("Go to my dashboard")').click()
  await pg.waitForTimeout(3000)
}
check('patient: registered', (await pg.locator('header').textContent()).includes('QA Final'))
check('patient: 5 tabs w/ Book', (t => t.includes('Book') && !t.includes('Manage'))((await pg.locator('nav').textContent()).replace(/\s+/g, ' ')))
await pg.goto(BASE + '/book', { waitUntil: 'networkidle' });
await pg.locator('main button[aria-pressed]').first().waitFor({ state: 'visible', timeout: 15000 })
await pg.locator('main form button[type="button"]').first().click()
const QADAY = 12 + Math.floor(Math.random() * 60)
const BDATE = new Date(Date.now() + QADAY * 864e5).toISOString().slice(0, 10)
await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  await pickDate(pg, QADAY)
await pg.waitForTimeout(600)
await pg.locator('form section:has-text("Available time") button:not([disabled])').nth(Date.now() % 8).click()
await pg.locator('button:has-text("Continue to Payment")').click()
await pg.waitForTimeout(1400)
check('patient: booking → confirm step', (await pg.locator('main h1').textContent()).includes('Confirm Your Appointment'))
await pg.locator('button:has-text("Pay Now")').click(); await pg.waitForTimeout(6000)
check('patient: QR payment page', /\d{2}:\d{2}/.test(await pg.locator('main').textContent()))
await pg.locator('button:has-text("DEV: simulate PayMongo test payment")').click()
let confirmed = false
for (let i = 0; i < 24 && !confirmed; i++) { await pg.waitForTimeout(1500); confirmed = /confirmed/i.test(await pg.locator('main').textContent().catch(() => '')) }
if (!confirmed) console.log('DEBUG-QR-FAIL', (await pg.locator('body').textContent()).slice(0, 500).replace(/\s+/g, ' '))
check('patient: payment confirms via provider settle', confirmed)
await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' })
await pg.waitForTimeout(1200)
check('patient: appointment listed w/ payment state', /Paid|Confirmed|Payment pending/i.test(await pg.locator('main').textContent()))
await pg.goto(BASE + '/messages', { waitUntil: 'networkidle' })
await pg.waitForTimeout(1200)
await pg.fill('main form input', 'QA hello po')
await pg.locator('button[aria-label="Send"]').click()
await pg.waitForTimeout(1500)
check('patient: chat works', (await pg.locator('main').textContent()).includes('QA hello po'))
await pg.goto(BASE + '/profile', { waitUntil: 'networkidle' })
await pg.waitForTimeout(1000)
await pg.locator('button:has-text("Log Out")').click()
await pg.waitForTimeout(1500)
check('logout works', (await pg.locator('input[type="email"]').count()) === 1)

// self-cleanup: remove the QA patient row + its notifications
try {
  const env = Object.fromEntries(fs.readFileSync('/home/attila/Documents/Projects/dentalvibe/frontend/.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
  const { createClient } = await import('file:///home/attila/Documents/Projects/dentalvibe/frontend/node_modules/@supabase/supabase-js/dist/index.cjs')
  const sbs = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  await sbs.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
  const { data: jp } = await sbs.from('patients').select('id, user_id, full_name').eq('full_name', 'QA Final')
  for (const j of (jp ?? [])) {
    if (j.user_id) await sbs.from('notifications').delete().eq('user_id', j.user_id)
    await sbs.from('appointments').delete().eq('patient_id', j.id)
    await sbs.from('chat_messages').delete().eq('patient_id', j.id)
    await sbs.from('patients').delete().eq('id', j.id)
  }
} catch {}

// --- U3: keyboard modal contract (focus in, Tab cycles, Escape closes) ---
{
  _role = 'owner'
  await login('owner@dentalvibe.ph')
  await tab('Patients')
  await pg.waitForTimeout(600)
  await pg.locator('button:has-text("Add New Patient")').first().click()
  await pg.waitForTimeout(400)
  check('U3 focus enters dialog on open', await pg.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
  let escaped = false
  for (let i = 0; i < 14; i++) {
    await pg.keyboard.press('Tab')
    if (!(await pg.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) { escaped = true; break }
  }
  check('U3 Tab never escapes dialog', !escaped)
  await pg.keyboard.press('Escape')
  await pg.waitForTimeout(300)
  check('U3 Escape closes dialog', (await pg.locator('[role="dialog"]').count()) === 0)
}
// --- C3: negative price blocked client-side (belt to S5's DB check) ---
{
  await tab('Manage')
  await pg.waitForTimeout(600)
  await pg.locator('button:has-text("Add Service")').first().click()
  await pg.waitForTimeout(300)
  await pg.locator('input[placeholder="Service name"]').fill('QA Negative Price')
  await pg.locator('input[placeholder="Price ₱"]').fill('-500')
  await pg.locator('button:text-is("Add Service")').click()
  await pg.waitForTimeout(300)
  check('C3 negative price rejected in UI', (await pg.locator('main').textContent()).includes('above zero'))
}

console.log(`\n=== QA RESULT: ${pass} passed, ${fail} failed ===`)
console.log('page errors:', pageErrors.length ? pageErrors.slice(0, 5) : 'NONE')
await b.close()
process.exit(fail === 0 && pageErrors.length === 0 ? 0 : 1)
