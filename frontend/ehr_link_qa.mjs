// ehr_link_qa.mjs — EHR deep link + RBAC + nav checks. usage: QA_BASE=http://localhost:4176 node ehr_link_qa.mjs
// 1. owner opens patient EHR from /owner/patients → URL contains patient id
// 2. full page reload of /ehr/<id> still shows the same record
// 3. new browser tab with same URL shows the record
// 4. browser Back/Forward keep working (no crash, correct screens)
// 5. patient (maria) opening another patient's /ehr/<id> sees no clinical data
import { chromium } from './qa_playwright.mjs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

const b = await chromium.launch()
const ctx = await b.newContext()
const pg = await ctx.newPage()
const login = async (email) => {
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} })
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', email)
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(2200)
}
const main = () => pg.locator('main').textContent()

// ── owner: list → EHR → URL carries patient id ──
await login('owner@dentalvibe.ph')
await pg.goto(BASE + '/owner/patients', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
const pName = 'Maria Santos'
await pg.locator(`main button:has-text("${pName}")`).first().click(); await pg.waitForTimeout(1800)
const url1 = pg.url()
const pid = url1.split('/ehr/')[1]?.split(/[?#]/)[0]
check('1a. EHR URL contains patient id', !!pid, url1)
let txt = await main()
check('1b. same patient record shown', txt.includes(pName) && txt.includes('Patient Record'))

// ── 2. full page reload ──
await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1800)
txt = await main()
check('2. reload of /ehr/<id> shows same record', txt.includes(pName) && txt.includes('Patient Record'), pg.url())

// ── 3. new tab, same URL (sessions are per-tab here → log in first, then deep-link) ──
const pg2 = await ctx.newPage()
await pg2.goto(url1, { waitUntil: 'load' }); await pg2.waitForTimeout(2500)
await pg2.fill('input[type="email"]', 'owner@dentalvibe.ph')
await pg2.fill('input[type="password"]', 'password123')
await pg2.locator('form button:has-text("Sign In")').last().click(); await pg2.waitForTimeout(2500)
await pg2.goto(url1, { waitUntil: 'load' }); await pg2.waitForTimeout(2500)
const txt2 = await pg2.locator('main').textContent()
check('3. new tab shows the record', txt2.includes(pName) && txt2.includes('Patient Record'), pg2.url())
await pg2.close()

// ── 4. Back / Forward ──
await pg.goBack(); await pg.waitForTimeout(1500)
txt = await main()
check('4a. Back returns to patients list', txt.includes('No patients found') === false && pg.url().includes('/owner/patients') && txt.includes('Patients'))
await pg.goForward(); await pg.waitForTimeout(1500)
txt = await main()
check('4b. Forward re-opens the record', pg.url().includes('/ehr/') && txt.includes('Patient Record') && txt.includes(pName))

// ── 5. patient RBAC: direct /ehr/<id> as maria ──
await login('maria@dentalvibe.ph')
await pg.goto(url1, { waitUntil: 'networkidle' }); await pg.waitForTimeout(1800)
txt = await main()
check('5. patient cannot open other patient EHR', !txt.includes('Patient Record') && !txt.includes(pName),
      (txt.match(/patient record|missing|placeholder|not found|no longer|home/i) || ['redirect'])[0])

await b.close()
console.log(`\n===== EHR LINK QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
