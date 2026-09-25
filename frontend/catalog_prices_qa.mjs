// catalog_prices_qa.mjs — regression checks for: service catalog (inactive hidden
// from booking), price-exception page (fresh base, validation, error surfacing),
// and clinic-name cache propagation (rename reaches mounted headers in-session).
// Run (from frontend/): QA_BASE=http://localhost:4176 node catalog_prices_qa.mjs
import { chromium } from './qa_playwright.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
await sb.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

const { data: svcs } = await sb.from('services').select('id, name, price').order('price')
const S = svcs.find((s) => s.name === 'Consultation')
const WHITE = svcs.find((s) => s.name === 'Whitening')
const { data: pats } = await sb.from('patients').select('id, full_name').eq('full_name', 'Maria Santos')
const MARIA = pats[0]
const OLD_CLINIC = (await sb.from('clinic_settings').select('clinic_name').limit(1).maybeSingle()).data?.clinic_name
await sb.from('service_prices').delete().eq('service_id', S.id) // clean slate on the test service

const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
const pg = await ctx.newPage()
const errs = []
pg.on('pageerror', (e) => errs.push(String(e).slice(0, 150)))
const login = async (email) => {
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', email); await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click(); await pg.waitForTimeout(2500)
}
const txt = async (sel = 'main') => (await pg.locator(sel).textContent()).replace(/\s+/g, ' ')
const rowFor = (name) => pg.locator('main div').filter({ has: pg.locator(`span:text-is("${name}")`) }).last()
const excRow = async (svcId, pid) => (await sb.from('service_prices').select('price').eq('service_id', svcId).eq('patient_id', pid)).data

// ── 1. service catalog: inactive service hidden from booking, still managed by owner
await sb.from('services').update({ active: false }).eq('id', WHITE.id)
await login('maria@dentalvibe.ph')
await pg.goto(BASE + '/book', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
const book = await txt()
check('catalog: inactive service hidden from booking', !book.includes('Whitening'))
check('catalog: active services still listed', book.includes('Consultation'))
await login('owner@dentalvibe.ph')
await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
const mg = await txt()
check('catalog: owner sees inactive service in manage', mg.includes('Whitening') && await rowFor('Whitening').locator('button[aria-label="Activate service"]').count() === 1)
await rowFor('Whitening').locator('button[aria-label="Activate service"]').click()
await pg.waitForTimeout(1500)
check('catalog: owner can re-activate from manage', await rowFor('Whitening').locator('button[aria-label="Deactivate service"]').count() === 1)
await sb.from('services').update({ active: true }).eq('id', WHITE.id)

// ── 2. clinic-name cache: rename propagates to mounted header without reload
const NEW = 'QA Clinic ' + Date.now()
await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
await pg.getByLabel('Clinic name').fill(NEW)
await pg.locator('button:has-text("Save Changes")').click(); await pg.waitForTimeout(2500)
check('clinic-name: header updates in-session after save', (await txt('header')).includes(NEW), (await txt('header')).slice(0, 60))
await pg.locator('nav a, nav button').filter({ hasText: 'Income' }).first().click().catch(() => {})
await pg.waitForTimeout(2000)
check('clinic-name: SPA navigation shows new name', (await txt('header')).includes(NEW))
await sb.from('clinic_settings').update({ clinic_name: OLD_CLINIC }).eq('id', 1)

// ── 3. price-exception page: stale URL base must not leak into new exceptions
await sb.from('services').update({ price: 600 }).eq('id', S.id) // base edited since the URL was built
await pg.goto(`${BASE}/owner/manage/prices?service=${S.id}&name=Consultation&base=500`, { waitUntil: 'networkidle' })
await pg.waitForTimeout(1500)
check('prices: page shows fresh base price, not stale URL param', (await txt()).includes('Base price for everyone: ₱600'), (await txt()).match(/Base price for everyone: ₱[\d,]+/)?.[0] ?? 'no base line')
await rowFor('Maria Santos').locator('button[aria-label="Set custom price"]').click()
await pg.waitForTimeout(1500)
check('prices: new exception seeds at the FRESH base', (await excRow(S.id, MARIA.id))[0]?.price === 600, JSON.stringify(await excRow(S.id, MARIA.id)))

// ── 4. price-exception page: invalid price rejected visibly, input reverted
const inp = rowFor('Maria Santos').locator('input[type=number]')
await inp.fill('-500'); await inp.blur(); await pg.waitForTimeout(1200)
check('prices: invalid price shows error message', (await txt()).includes('above zero'))
check('prices: invalid price reverts the input', (await inp.inputValue()) === '600', await inp.inputValue())
check('prices: invalid price never reaches the DB', (await excRow(S.id, MARIA.id))[0]?.price === 600)

// ── 5. valid edit persists; remove works
await inp.fill('777'); await inp.blur(); await pg.waitForTimeout(1500)
check('prices: valid edit saves to DB', (await excRow(S.id, MARIA.id))[0]?.price === 777)
await pg.reload({ waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
check('prices: edit persists after reload', (await rowFor('Maria Santos').locator('input[type=number]').inputValue()) === '777')
await rowFor('Maria Santos').locator('button[aria-label="Remove custom price"]').click()
await pg.waitForTimeout(1500)
check('prices: remove clears the exception', (await excRow(S.id, MARIA.id)).length === 0)

// cleanup
await sb.from('service_prices').delete().eq('service_id', S.id)
await sb.from('services').update({ price: S.price }).eq('id', S.id)
await sb.from('clinic_settings').update({ clinic_name: OLD_CLINIC }).eq('id', 1)
console.log(`\n===== CATALOG/PRICES QA: ${pass} passed, ${fail} failed =====`)
console.log('page errors:', errs.length ? errs.slice(0, 5) : 'NONE')
await b.close()
process.exit(fail === 0 && errs.length === 0 ? 0 : 1)
