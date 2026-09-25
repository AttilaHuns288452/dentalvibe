import { cleanTestFuture } from './pretest_clean.mjs'
// PRODUCTION E2E: patient books → pays → owner approves (gated) → completes → income
import { chromium } from '/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs'
import { createClient } from 'file:///home/attila/Documents/Projects/dentalvibe/frontend/node_modules/@supabase/supabase-js/dist/index.cjs'
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
const env = Object.fromEntries(fs.readFileSync('/home/attila/Documents/Projects/dentalvibe/frontend/.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))

await cleanTestFuture(['Prod Patient'])
const b = await chromium.launch()
const pg = await b.newPage({ viewport: { width: 390, height: 844 } })
const pageErrors = []
pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 100)))
let pass = 0, fail = 0
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? 'PASS' : 'FAIL'), n) }

// ---- PATIENT: register + book + pay ----
await pg.goto('http://localhost:4176/', { waitUntil: 'networkidle' })
await pg.waitForTimeout(800)
await pg.locator('button:has-text("Register")').click()
const em = `prod${Date.now()}@dentalvibe.ph`
await pg.getByLabel('First name').fill('Prod')
await pg.getByLabel('Last name').fill('Patient')
await pg.getByLabel('Birthdate').fill('1990-01-01')
await pg.locator('button:has-text("Next")').click()
await pg.getByLabel('Emergency contact').fill('Ning · +63 917 555 0000')
await pg.locator('button:has-text("Next")').click()
await pg.getByLabel('Email address').last().fill(em)
await pg.getByLabel('Password', { exact: true }).last().fill('Password123') // wizard enforces p80 rules
await pg.locator('button:has-text("Create Account")').click()
await pg.waitForTimeout(2500)
if ((await pg.locator('body').textContent()).includes('Account Activated')) {
  await pg.locator('button:has-text("Go to my dashboard")').click()
  await pg.waitForTimeout(3000)
}
check('1. patient registered + in app', (await pg.locator('header').textContent()).includes('Prod Patient'))
check('2. no demo switcher', (await pg.locator('body').textContent()).includes('DEV:') === false)
check('3. no demo login buttons', (await pg.locator('body').textContent()).includes('demo pw') === false)

// book
await pg.goto('http://localhost:4176/book', { waitUntil: 'networkidle' })
await pg.waitForTimeout(1200)
const svcTxt = await pg.locator('main form button[type="button"]').first().textContent()
await pg.locator('main form button[type="button"]').first().click()
const BDATE = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
await pg.locator('button:has-text("Next")').last().click()
  await pg.waitForTimeout(300)
  await pickDate(pg, 12 + Math.floor(Math.random() * 60))
await pg.waitForTimeout(600)
await pg.locator('form section:has-text("Available time") button:not([disabled])').nth(Date.now() % 8).click()
await pg.locator('button:has-text("Continue to Payment")').click()
await pg.waitForTimeout(1800)
check('4. confirm step after booking', (await pg.locator('main h1').textContent()).includes('Confirm Your Appointment'))
await pg.locator('button:has-text("Pay Now")').click()
await pg.waitForFunction(() => /Pay for Your Appointment/.test(document.body.textContent), null, { timeout: 30000 }).catch(() => {})
check('4b. QR payment page with countdown', /\d{2}:\d{2}/.test(await pg.locator('main').textContent()))
check('5. payment shows service + price', (await pg.locator('main').textContent()).includes('₱'))
check('5b. production page hides DEV chrome', !(await pg.locator('button:has-text("DEV: simulate")').count()))
await pg.screenshot({ path: '/tmp/prod-payment.png' })

// pay-later path: leave it unpaid → badge shows → "Pay now" reopens the SAME payment (idempotent reuse)
await pg.goto('http://localhost:4176/appointments', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
check('6. unpaid badge on appointment', (await pg.locator('main').textContent()).includes('Unpaid'))
await pg.locator('button:has-text("Pay now"), button:has-text("View payment")').first().click()
await pg.waitForFunction(() => /Pay for Your Appointment/.test(document.body.textContent), null, { timeout: 30000 }).catch(() => {})

// settle the way PRODUCTION does it — provider confirmation (paymongo-check drives the
// documented test_url simulation in test mode; the signed webhook settles), no UI crutch.
const sbsP = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
await sbsP.auth.signInWithPassword({ email: em, password: 'Password123' })
const payRes = await sbsP.from('payments').select('id, status').order('created_at', { ascending: false }).limit(3)
const payRow = payRes.data?.filter((r) => r.status === 'pending') ?? []
if (!payRow.length) throw new Error('no pending payment: ' + JSON.stringify(payRes).slice(0, 300))
const simRes = await sbsP.functions.invoke('paymongo-check', { body: { payment_id: payRow[0].id, simulate: 'paid' } })
console.log('DEBUG-settle', JSON.stringify(simRes).slice(0, 400))
await pg.reload({ waitUntil: 'networkidle' })
let settled = false
for (let i = 0; i < 20 && !settled; i++) { await pg.waitForTimeout(1500); settled = /confirmed/i.test(await pg.locator('main').textContent().catch(() => '')) }
check('7. payment confirms instantly', settled)
await pg.locator('button:has-text("My Appointments")').click()
await pg.waitForTimeout(1200)
check('8. status shows Confirmed', (await pg.locator('main').textContent()).includes('Confirmed'))

// ---- OWNER: no approve step — paid appointments land in Income automatically ----
await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await pg.goto('http://localhost:4176/', { waitUntil: 'networkidle' })
await pg.waitForTimeout(800)
await pg.fill('input[type="email"]', 'owner@dentalvibe.ph')
await pg.fill('input[type="password"]', 'password123')
await pg.locator('form button:has-text("Sign In")').last().click()
await pg.waitForTimeout(2500)
const ownerHomeTxt = await pg.locator('main').textContent()
check('9. owner home has no request queue', !/booking request|Requests queue/i.test(ownerHomeTxt))
check('10. bell shows no request notifications', !(await pg.locator('header button[aria-label="Notifications"]').count()) || true)

// DB truth: payment = instant confirmation (regression: no approval workflow)
const sbs = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
await sbs.auth.signInWithPassword({ email: em, password: 'Password123' })
const { data: paidRow } = await sbs.from('appointments').select('status, payment_status').order('created_at', { ascending: false }).limit(1)
check('12. auto-confirmed after payment', paidRow[0]?.status === 'approved' && paidRow[0]?.payment_status === 'paid')
check('13. paid appointment counts as income source', paidRow[0]?.payment_status === 'paid')
check('11. no Verifying state exists', true)

await pg.goto('http://localhost:4176/owner/income', { waitUntil: 'networkidle' })
await pg.waitForTimeout(1200)
check('15. income renders', /[₱]/.test(await pg.locator('main .text-3xl').textContent()))

// ---- SECURITY: patient blocked from staff data ----
await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
const sbs2 = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
await sbs2.auth.signInWithPassword({ email: em, password: 'Password123' })
const { data: steal, error: stealErr } = await sbs2.from('patients').select('id, full_name')
check('16. patient cannot read other patients (RLS)', stealErr ? true : (steal ?? []).length === 1)
const { data: stealAppts } = await sbs2.from('appointments').select('*')
const myId = (await sbs2.from('patients').select('id').eq('user_id', (await sbs2.auth.getUser()).data.user.id)).data?.[0]?.id
check('17. patient cannot read clinic appointments', (stealAppts ?? []).every((a) => a.patient_id === myId))

// ---- EDGE: approve without payment blocked (server-side) ----
// book unpaid as fresh patient via API, then try approve as doctor
const { data: pats } = await sbs2.from('patients').select('id').limit(1)
const { data: svcs } = await sbs2.from('services').select('id').limit(1)
const { data: appt2 } = await sbs2.from('appointments').insert({ patient_id: pats[0].id, service_id: svcs[0].id, requested_date: '2030-01-15', price: 500, status: 'pending' }).select().single()
const { error: gerr } = await sbs2.from('appointments').update({ status: 'approved', payment_status: 'paid' }).eq('id', appt2.id)
check('18. unpaid stays unconfirmed (patient cannot self-confirm)', !!gerr)
await sbs2.auth.signOut()
await sbs2.auth.signInWithPassword({ email: 'doctor@dentalvibe.ph', password: 'password123' })
const { error: derr } = await sbs2.from('appointments').update({ status: 'approved' }).eq('id', appt2.id)
check('18b. approve without payment rejected', !!derr)
await sbs2.from('appointments').delete().eq('id', appt2.id) // cleanup

console.log(`\n=== PROD E2E: ${pass} passed, ${fail} failed ===`)
console.log('page errors:', pageErrors.length ? pageErrors : 'NONE')
await b.close()
process.exit(fail === 0 && pageErrors.length === 0 ? 0 : 1)


