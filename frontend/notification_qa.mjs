// notification_qa.mjs — in-app notification deep links, focused suite (no push):
//   1. row click navigates to the row's stored route (scoped card visible)
//   2. row click marks the row read; a row WITHOUT a route marks read only
//   3. 'Mark all read' marks everything read and NEVER navigates
//   4. foreign / stale / unknown routes render safely with zero private data
// Run (from frontend/): SB_SECRET=<service key> node notification_qa.mjs   (serve :4176)
import fs from 'fs'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { chromium } from './qa_playwright.mjs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const SB = env.VITE_SUPABASE_URL
const svc = createClient(SB, process.env.SB_SECRET)
const BASE = process.env.QA_BASE || 'http://localhost:4176'

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

const b = await chromium.launch()
const pg = await (await b.newContext()).newPage()
const pageErrors = []
pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

// ── login as the patient whose notifications we drive ──
await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
await pg.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch {} })
await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
await pg.fill('input[type="email"]', 'maria@dentalvibe.ph')
await pg.fill('input[type="password"]', 'password123')
await pg.locator('form button:has-text("Sign In")').last().click()
await pg.waitForTimeout(2200)

// ── seed: maria's own appointment (deep-link target) + juan's (foreign canary) ──
const { data: me } = await svc.from('patients').select('id, user_id').eq('email', 'maria@dentalvibe.ph').maybeSingle()
const { data: juan } = await svc.from('patients').select('id, full_name').eq('email', 'juan@dentalvibe.ph').maybeSingle()
const { data: svcRow } = await svc.from('services').select('id, price').eq('active', true).order('price').limit(1).maybeSingle()
const mkAppt = async (patient_id) => {
  const d = new Date(Date.now() + (40 + Math.floor(Math.random() * 30)) * 864e5)
  const { data } = await svc.from('appointments').insert({
    patient_id, service_id: svcRow.id, service_ids: [svcRow.id], scheduled_at: d.toISOString(),
    requested_date: d.toISOString().slice(0, 10), price: svcRow.price, status: 'pending', payment_status: 'unpaid',
  }).select().maybeSingle()
  return data
}
const myAppt = await mkAppt(me.id)
const foreignAppt = await mkAppt(juan.id)

const ts = Date.now()
const staleId = crypto.randomUUID()
const keys = [] // every notification row this run seeds — deleted at the end
const seed = async (title, route) => {
  const dedupe_key = 'nqa:' + title + ':' + ts
  const { data } = await svc.from('notifications').insert({ user_id: me.user_id, title, body: 'qa row', route, dedupe_key }).select().maybeSingle()
  keys.push(dedupe_key)
  return data
}
const rows = {
  nav: await seed('NQANAV' + ts, '/appointments?appt=' + myAppt.id),
  plain: await seed('NQAPLAIN' + ts, null),
  foreign: await seed('NQAFOREIGN' + ts, '/appointments?appt=' + foreignAppt.id),
  stale: await seed('NQASTALE' + ts, '/appointments?appt=' + staleId),
  unknown: await seed('NQAUNKNOWN' + ts, '/no-such-page/nqa-' + ts),
}
const readFlag = async (id) => (await svc.from('notifications').select('read').eq('id', id).maybeSingle()).data?.read
const openList = async () => { await pg.goto(BASE + '/notifications', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1000) }
const clickRow = async (title) => { await pg.locator(`button:has-text("${title}")`).first().waitFor(); await pg.locator(`button:has-text("${title}")`).first().click(); await pg.waitForTimeout(1500) }

// ── 1. seeded rows render ──
await openList()
await pg.locator('button:has-text("NQANAV' + ts + '")').first().waitFor()
const listTxt = await pg.locator('main').textContent()
check('1. seeded notification rows render', ['NQANAV', 'NQAPLAIN', 'NQAFOREIGN', 'NQASTALE', 'NQAUNKNOWN'].every((t) => listTxt.includes(t + ts)))

// ── 2. row click with a route: navigate + mark read ──
await clickRow('NQANAV' + ts)
check('2. row click navigates to its stored route', pg.url().includes('/appointments?appt=' + myAppt.id), pg.url())
check('3. scoped appointment card visible after row click', await pg.locator('#appt-' + myAppt.id).isVisible().catch(() => false))
check('4. row click marks the row read', (await readFlag(rows.nav.id)) === true)

// ── 3. row WITHOUT a route: mark read only, no navigation ──
await openList()
const beforeUrl = pg.url()
await clickRow('NQAPLAIN' + ts)
check('5. route-less row click does NOT navigate', pg.url() === beforeUrl && beforeUrl.endsWith('/notifications'), pg.url())
check('6. route-less row click still marks read', (await readFlag(rows.plain.id)) === true)

// ── 4. foreign-route safety: another patient's appointment id (RLS) ──
await clickRow('NQAFOREIGN' + ts)
const fTxt = await pg.locator('main').textContent()
check('7. foreign appointment route: navigates but leaks zero private data',
  pg.url().includes('/appointments?appt=' + foreignAppt.id) && !fTxt.includes(juan.full_name) && (await pg.locator('#appt-' + foreignAppt.id).count()) === 0, pg.url())

// ── 5. stale route: random uuid that matches nothing ──
await openList()
await clickRow('NQASTALE' + ts)
const sTxt = await pg.locator('main').textContent()
check('8. stale route (random uuid) renders safely — no crash, no card, no data',
  pg.url().includes('/appointments?appt=' + staleId) && (await pg.locator('#appt-' + staleId).count()) === 0 && !sTxt.includes(juan.full_name)
  && (sTxt.includes('Appointment') || sTxt.includes('appointment')), pg.url())

// ── 6. unknown path: router normalizes to the safe placeholder ──
await openList()
await clickRow('NQAUNKNOWN' + ts)
const uTxt = await pg.locator('main').textContent()
check('9. unknown route renders the safe placeholder (no crash)', pg.url().includes('/no-such-page/nqa-' + ts) && uTxt.includes('coming soon'), pg.url())

// ── 7. 'Mark all read' marks read and never navigates ──
const allRow = await seed('NQAALL' + ts, '/appointments?appt=' + myAppt.id) // unread, so the button shows
await openList()
await pg.locator('button:has-text("Mark all read")').waitFor()
const markUrl = pg.url()
await pg.locator('button:has-text("Mark all read")').click()
await pg.waitForTimeout(1500)
check('10. Mark all read NEVER navigates', pg.url() === markUrl && markUrl.endsWith('/notifications'), pg.url())
const { data: stillUnread } = await svc.from('notifications').select('id').eq('user_id', me.user_id).eq('read', false).in('dedupe_key', keys)
check('11. Mark all read marked every row read', (stillUnread ?? []).length === 0 && (await readFlag(allRow.id)) === true, 'unread=' + (stillUnread ?? []).length)

check('12. no page errors', pageErrors.length === 0, pageErrors.join(';'))

// cleanup (rows owned by this run)
await svc.from('notifications').delete().in('dedupe_key', keys)
for (const a of [myAppt, foreignAppt]) {
  await svc.from('notifications').delete().like('dedupe_key', '%' + a.id + '%') // trigger-made rows for these appointments
  await svc.from('appointments').delete().eq('id', a.id)
}

await b.close()
console.log(`\n===== NOTIFICATION QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
