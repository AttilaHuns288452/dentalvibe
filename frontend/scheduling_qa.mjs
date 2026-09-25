// scheduling_qa.mjs — clinic scheduling must derive from clinic_settings (single source of truth).
// Owner changes hours via the Manage UI → patient booking slots and the doctor calendar rows must
// both follow; original settings are restored at the end. No data is created (no bookings).
// Run (from frontend/): node scheduling_qa.mjs   (QA_BASE defaults to http://localhost:4176)
import { chromium } from '/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY) // clinic_settings is public-read; all writes go through the Owner UI
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }
const pad = (n) => String(n).padStart(2, '0')
const settingsInDb = async () => (await sb.from('clinic_settings').select('open_time, close_time, open_days').eq('id', 1).single()).data

const b = await chromium.launch()
const pg = await b.newPage()
const login = async (email, pw = 'password123') => {
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', email); await pg.fill('input[type="password"]', pw)
  await pg.locator('form button:has-text("Sign In")').last().click(); await pg.waitForTimeout(2500)
}
const slotTexts = async () => (await pg.locator('button.h-10').allTextContents()).map((t) => t.trim())

// Owner Manage UI: set hours + open days, save
const setHoursUI = async (open, close, days) => {
  await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  await pg.locator('input[type="time"]').nth(0).fill(open)
  await pg.locator('input[type="time"]').nth(1).fill(close)
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
    const btn = pg.locator('button', { hasText: d.toUpperCase() }).first()
    const on = (await btn.getAttribute('class')).includes('border-primary-600')
    if (on !== days.includes(d)) { await btn.click(); await pg.waitForTimeout(200) }
  }
  await pg.locator('button:has-text("Save Changes")').click(); await pg.waitForTimeout(2000)
}

// Patient booking: pick first service → step 2 → month+2, last enabled (open, future) day → return its ISO
const pickFarDate = async () => {
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.locator('main form button[type="button"]').first().click() // first (cheapest) service
  await pg.locator('button:has-text("Next")').last().click(); await pg.waitForTimeout(800)
  const t = new Date(); const first = new Date(t.getFullYear(), t.getMonth() + 2, 1)
  await pg.locator('button[aria-label="Next month"]').click(); await pg.waitForTimeout(300)
  await pg.locator('button[aria-label="Next month"]').click(); await pg.waitForTimeout(300)
  const cells = pg.locator('div.grid.grid-cols-7').nth(1).locator('button:not([disabled])')
  const day = (await cells.nth((await cells.count()) - 1).textContent()).trim()
  await cells.nth((await cells.count()) - 1).click(); await pg.waitForTimeout(1200) // let busy-ranges + slots load
  return `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(+day)}`
}

// ── original settings (to restore) ──
const orig = await settingsInDb()
check('S0. original settings read (restore baseline)', !!orig?.open_time, JSON.stringify(orig ?? {}))

try {
  // ── phase A: owner sets 09:00–18:00 Mon–Sat ──
  await login('owner@dentalvibe.ph')
  await setHoursUI('09:00', '18:00', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  const saved = await settingsInDb()
  check('S1. settings saved as 09:00–18:00 Mon–Sat', /09:00/.test(saved?.open_time ?? '') && /18:00/.test(saved?.close_time ?? '') && (saved?.open_days ?? []).length === 6, JSON.stringify(saved ?? {}))

  // ── phase B: patient booking follows ──
  await login('maria@dentalvibe.ph')
  const dateISO = await pickFarDate()
  const slots = await slotTexts()
  check('S2. first slot is 9:00 AM', slots[0] === '9:00 AM', 'first=' + slots[0] + ' date=' + dateISO)
  check('S3. no slot earlier than 9:00 AM', !slots.some((s) => /^(7|8):/.test(s)), slots.slice(0, 3).join(','))
  check('S4. boundary: last slot ends at/before closing (17:30→18:00)', slots.at(-1) === '5:30 PM' && !slots.includes('6:00 PM'), 'last=' + slots.at(-1))

  // ── phase C: doctor calendar shows the same hours ──
  await login('doctor@dentalvibe.ph')
  await pg.goto(BASE + '/doctor/calendar', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  await pg.fill('input[type="date"]', dateISO); await pg.waitForTimeout(800)
  const rows = (await pg.locator('div.w-16').allTextContents()).map((s) => s.trim())
  check('S5. calendar first hour row is 9 AM', rows[0] === '9 AM', rows.slice(0, 2).join(','))
  check('S6. calendar rows end at 5:30 PM (9–18 window)', rows.includes('5:30 PM') && !rows.includes('6 PM'), 'last=' + rows.at(-1))
} catch (e) {
  check('phase A–C ran without crashing', false, e.message.slice(0, 160))
}

// ── cleanup + revert verification (always runs) ──
try {
  await login('owner@dentalvibe.ph')
  await setHoursUI(orig.open_time.slice(0, 5), orig.close_time.slice(0, 5), orig.open_days)
} catch (e) {
  check('restore settings via UI', false, e.message.slice(0, 160))
}
const restored = await settingsInDb()
check('S7. settings restored', restored?.open_time === orig.open_time && restored?.close_time === orig.close_time && JSON.stringify(restored?.open_days) === JSON.stringify(orig.open_days), JSON.stringify(restored ?? {}))

await login('maria@dentalvibe.ph')
const dateISO2 = await pickFarDate()
const slots2 = await slotTexts()
check('S8. booking follows restore: first slot 10:00 AM', slots2[0] === '10:00 AM', 'first=' + slots2[0] + ' date=' + dateISO2)
check('S9. boundary after restore: last slot 4:30 PM (ends 17:00)', slots2.at(-1) === '4:30 PM', 'last=' + slots2.at(-1))

await b.close()
console.log(`\n===== SCHEDULING QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
