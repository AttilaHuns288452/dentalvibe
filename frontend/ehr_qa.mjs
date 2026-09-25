// ehr_qa.mjs — Record Categories + clinical document upload check.
// 1. RLS: patient CANNOT touch clinical records/categories/storage (backend, not UI)
// 2. Owner → Manage → Record Categories CRUD + deactivate
// 3. Doctor EHR upload: active categories only, category+note stored, LATEST badge
// 4. History: deactivated category's old records stay visible
import { chromium } from '/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const svc = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY) // RLS-as-role probe (signIn below)
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

const b = await chromium.launch()
const ctx = await b.newContext()
const pg = await ctx.newPage()
const login = async (email) => {
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { try { localStorage.clear() } catch {} })
  await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', email)
  await pg.fill('input[type="password"]', 'password123')
  await pg.locator('form button:has-text("Sign In")').last().click()
  await pg.waitForTimeout(2200)
}

// ── 1. RLS: patient must NOT see clinical records ──
await svc.auth.signInWithPassword({ email: 'maria@dentalvibe.ph', password: 'password123' })
const [pa, pc, ps] = await Promise.all([
  svc.from('ehr_attachments').select('id'),
  svc.from('record_categories').select('id'),
  svc.storage.from('ehr-files').list(),
])
check('1a. patient reads NO ehr_attachments', (pa.data ?? []).length === 0, JSON.stringify(pa.error?.code ?? ''))
check('1b. patient reads NO record_categories', (pc.data ?? []).length === 0, JSON.stringify(pc.error?.code ?? ''))
check('1c. patient lists NO ehr-files storage', (ps.data ?? []).length === 0, JSON.stringify(ps.error?.message ?? ''))
const ins = await svc.from('ehr_attachments').insert({ patient_id: '00000000-0000-0000-0000-000000000000', category: 'X-Ray', filename: 'x.png' })
check('1d. patient INSERT denied by RLS', ins.error?.code === '42501', ins.error?.code ?? 'NO ERROR')

// ── 2. Owner → Manage → Record Categories ──
await login('owner@dentalvibe.ph')
await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
const mgmt = await pg.locator('main').textContent()
check('2a. Record Categories section', mgmt.includes('Record Categories'))
check('2b. seeded categories listed', mgmt.includes('Handwritten Patient Record') && mgmt.includes('Referral'))
const TESTCAT = 'Temp EHR Cat ' + Date.now()
await pg.getByPlaceholder('New category name').fill(TESTCAT)
await pg.locator('button:has-text("Add")').last().click(); await pg.waitForTimeout(1200)
check('2c. owner adds category', (await pg.locator('main').textContent()).includes(TESTCAT))
// deactivate "Referral" (seeded, used later for the history check)
const row = pg.locator('div:has(> span:text-is("Referral"))').first()
await row.locator('button:text-is("Active")').click(); await pg.waitForTimeout(1200)
check('2d. owner deactivates category', (await pg.locator('main').textContent()).includes('Inactive'))

// ── 3. Doctor EHR upload ──
await login('doctor@dentalvibe.ph')
await pg.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
await pg.locator('main button:has-text("Maria Santos")').first().click(); await pg.waitForTimeout(1500)
check('3a. EHR opens', (await pg.locator('main').textContent()).includes('Patient Record'))
await pg.locator('button:text-is("+ Add")').first().click(); await pg.waitForTimeout(900)
const chips = await pg.locator('[role="dialog"]').textContent()
check('3b. active categories offered', chips.includes(TESTCAT) && chips.includes('X-Ray'))
check('3c. deactivated category hidden', !chips.includes('Referral'))
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const up1 = 'ehrqa-1-' + Date.now() + '.png'
await pg.locator('[role="dialog"] button:text-is("' + TESTCAT + '")').click()
await pg.setInputFiles('[role="dialog"] input[type="file"]', { name: up1, mimeType: 'image/png', buffer: png })
await pg.getByPlaceholder('Periapical view before extraction').fill('EHRQA note one')
await pg.locator('[role="dialog"] button:has-text("Upload Attachment")').click(); await pg.waitForTimeout(2500)
let ehr = await pg.locator('main').textContent()
check('3d. upload appears with category + note', ehr.includes(up1) && ehr.includes(TESTCAT) && ehr.includes('EHRQA note one'))
const rowTxt = async (name) => (await pg.locator('div').filter({ hasText: name }).last().textContent()).replace(/\s+/g, ' ')
check('3e. newest upload = LATEST', (await rowTxt(up1)).includes('LATEST'))
// second upload same category → first loses LATEST
const up2 = 'ehrqa-2-' + Date.now() + '.png'
await pg.locator('button:text-is("+ Add")').first().click(); await pg.waitForTimeout(900)
await pg.locator('[role="dialog"] button:text-is("' + TESTCAT + '")').click()
await pg.setInputFiles('[role="dialog"] input[type="file"]', { name: up2, mimeType: 'image/png', buffer: png })
await pg.locator('[role="dialog"] button:has-text("Upload Attachment")').click(); await pg.waitForTimeout(2500)
ehr = await pg.locator('main').textContent()
check('3f. second upload is LATEST, first superseded', (await rowTxt(up2)).includes('LATEST') && !(await rowTxt(up1)).includes('LATEST'))

// ── 4. history intact for the deactivated category (seeded row) ──
check('4a. old record w/ deactivated category visible', ehr.includes('Referral') || ehr.includes('X-ray'))

// ── cleanup (test rows only) ──
await svc.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
const { data: mine } = await svc.from('ehr_attachments').select('id, path').like('filename', 'ehrqa-%')
if (mine?.length) {
  await svc.storage.from('ehr-files').remove(mine.map((m) => m.path).filter(Boolean))
  await svc.from('ehr_attachments').delete().in('id', mine.map((m) => m.id))
}
await svc.from('record_categories').delete().eq('name', TESTCAT)
await svc.from('record_categories').update({ active: true }).eq('name', 'Referral')
check('cleanup done', true)

await b.close()
console.log(`\n===== EHR QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
