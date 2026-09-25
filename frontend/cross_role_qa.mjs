// cross_role_qa.mjs — gap journey: flows the main suites don't cover.
// A. Owner creates a Doctor → doctor logs in → correct portal → deactivate → remove
// B. Owner changes clinic settings → Patient + Doctor see the change → revert
// C. Pricing precedence: per-patient exception beats base; other patients unaffected;
//    historical transactions never change when prices change
// D. Multi-tab: patient + owner sessions coexist without flipping
// Run (from frontend/): SB_SECRET=<service key> QA_BASE=https://dentalvibe.vercel.app node cross_role_qa.mjs
import { chromium } from '/home/attila/.hermes/hermes-agent/node_modules/playwright/index.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SB_SECRET)
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }
const TS = Date.now()

const b = await chromium.launch()
const ctx = await b.newContext()
const pg = await ctx.newPage()
const login = async (email, pw = 'password123') => {
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await pg.fill('input[type="email"]', email); await pg.fill('input[type="password"]', pw)
  await pg.locator('form button:has-text("Sign In")').last().click(); await pg.waitForTimeout(2500)
}
const txt = async () => (await pg.locator('body').textContent()).replace(/\s+/g, ' ')

// ═══ A. DOCTOR LIFECYCLE (§14/15) ═══
const DOC_NAME = 'QA Doc ' + TS
const DOC_EMAIL = 'qadoc' + TS + '@dentalvibe.ph'
await login('owner@dentalvibe.ph')
await pg.goto(BASE + '/owner/staff', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
await pg.locator('button:has-text("Add New Dentist")').first().click(); await pg.waitForTimeout(800)
await pg.getByPlaceholder('Full name (e.g. Miguel Ramos)').fill(DOC_NAME)
await pg.getByPlaceholder('Email address').fill(DOC_EMAIL)
await pg.locator('form button').last().click(); await pg.waitForTimeout(4000)
const staffTxt = await txt()
const tempPw = (await pg.locator('div:has(> b)').filter({ hasText: 'Default password' }).locator('b').first().textContent().catch(() => null))?.trim()
check('A1. owner creates doctor (temp password issued)', !!tempPw, tempPw ? '' : staffTxt.slice(0, 120))
check('A2. new doctor in Staff roster', staffTxt.includes(DOC_NAME))

if (tempPw) {
  await login(DOC_EMAIL, tempPw)
  await pg.waitForTimeout(1500)
  const t = await txt()
  check('A3. new doctor logs in with temp password', t.includes('Dentist Portal'), t.slice(0, 80))
  const nav = (await pg.locator('nav').allTextContents()).join(' ').replace(/\s+/g, ' ')
  check('A4. doctor portal (no Manage/Income)', nav.includes('Patients') && !nav.includes('Manage') && !nav.includes('Income'), 'nav=[' + nav.slice(0, 100) + '] head=[' + t.slice(0, 60) + ']')
  await pg.goto(BASE + '/doctor/patients', { waitUntil: 'networkidle' }); await pg.waitForFunction(() => /total/.test(document.body.textContent), null, { timeout: 15000 }).catch(() => {})
  check('A5. new doctor sees patient list', /total/.test(await txt()), (await txt()).slice(0, 100))
  // deactivate
  await login('owner@dentalvibe.ph')
  await pg.goto(BASE + '/owner/staff', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
  const row = pg.locator('div').filter({ has: pg.locator('span:text-is("' + DOC_NAME + '")') }).last()
  await row.locator('button:has-text("Deactivate"), button:has-text("Remove"), button:has-text("Active")').last().click().catch(() => {})
  await pg.waitForTimeout(1500)
  const afterDeact = await txt()
  check('A6. deactivated state reflected in Staff', afterDeact.includes('Deactivated') || afterDeact.includes('Inactive'))
  // cleanup: remove the doctor account + roster row
  await svc.from('dentists').delete().eq('email', DOC_EMAIL)
  const { data: du } = await svc.from('profiles').select('id').eq('email', DOC_EMAIL).maybeSingle()
  if (du?.id) await svc.from('profiles').delete().eq('id', du.id)
  check('A7. doctor cleaned up', !(await (await svc.from('dentists').select('email').eq('email', DOC_EMAIL)).data)?.length)
}

// ═══ B. SETTINGS PROPAGATION (§17) ═══
const NEW_NAME = 'QA Clinic ' + TS
await login('owner@dentalvibe.ph')
await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
await pg.getByLabel('Clinic name').fill(NEW_NAME)
await pg.locator('button:has-text("Save Changes")').click(); await pg.waitForTimeout(2000)
await login('maria@dentalvibe.ph')
check('B1. patient sees the new clinic name', (await txt()).includes(NEW_NAME))
await login('doctor@dentalvibe.ph')
check('B2. doctor sees the new clinic name', (await txt()).includes(NEW_NAME))
await login('owner@dentalvibe.ph')
await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
await pg.getByLabel('Clinic name').fill('D.A.R. Dental Clinic')
await pg.locator('button:has-text("Save Changes")').click(); await pg.waitForTimeout(2000)
check('B3. clinic name reverted', (await svc.from('clinic_settings').select('clinic_name').limit(1).maybeSingle()).data?.clinic_name === 'D.A.R. Dental Clinic')

// ═══ C. PRICING PRECEDENCE (§19/20) ═══
const { data: svcx } = await svc.from('services').select('id, name, price').order('price').limit(1).maybeSingle()
const { data: mariaRow } = await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1).maybeSingle()
// second patient with a real login (self-registered style)
const PW2 = 'Password123'
const EMAIL2 = 'qaprice' + TS + '@dentalvibe.ph'
const { data: au2 } = await svc.auth.admin.createUser({ email: EMAIL2, password: PW2, email_confirm: true })
await svc.from('profiles').update({ role: 'patient', full_name: 'QA Price ' + TS }).eq('id', au2.user.id)
const { data: p2 } = await svc.from('patients').insert({ user_id: au2.user.id, full_name: 'QA Price ' + TS }).select().maybeSingle()
if (svcx && mariaRow && p2) {
  const BASE_P = Number(svcx.price)
  const EXC = BASE_P - 100
  await svc.from('service_prices').delete().eq('service_id', svcx.id).eq('patient_id', mariaRow.id)
  await svc.from('service_prices').insert({ service_id: svcx.id, patient_id: mariaRow.id, price: EXC })
  // Maria sees the exception when booking
  await login('maria@dentalvibe.ph')
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.locator('main form button[type="button"]').filter({ hasText: svcx.name }).first().click()
  await pg.locator('button:has-text("Next")').last().click(); await pg.waitForTimeout(800)
  check('C1. exception patient sees special price', (await txt()).includes('Total₱' + EXC.toLocaleString('en-US')), (await txt()).match(/Total₱[\d,]+/)?.[0] ?? 'no total')
  // the other patient sees the base price — no leak
  await login(EMAIL2, PW2)
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.locator('main form button[type="button"]').filter({ hasText: svcx.name }).first().click()
  await pg.locator('button:has-text("Next")').last().click(); await pg.waitForTimeout(800)
  check('C2. other patient still sees base price', (await txt()).includes('Total₱' + BASE_P.toLocaleString('en-US')), (await txt()).match(/Total₱[\d,]+/)?.[0] ?? 'no total')
  // update the exception -> new value wins (per-patient price beats base)
  await svc.from('service_prices').update({ price: EXC - 50 }).eq('service_id', svcx.id).eq('patient_id', mariaRow.id)
  await login('maria@dentalvibe.ph')
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.locator('main form button[type="button"]').filter({ hasText: svcx.name }).first().click()
  await pg.locator('button:has-text("Next")').last().click(); await pg.waitForTimeout(800)
  check('C3. changed exception takes effect', (await txt()).includes('Total₱' + (EXC - 50).toLocaleString('en-US')), (await txt()).match(/Total₱[\d,]+/)?.[0] ?? 'no total')
  // historical immutability
  const { data: hist } = await svc.from('transactions').select('amount').eq('category', 'Service payment').limit(1).maybeSingle()
  await svc.from('services').update({ price: BASE_P + 999 }).eq('id', svcx.id)
  const { data: hist2 } = await svc.from('transactions').select('amount').eq('category', 'Service payment').limit(1).maybeSingle()
  check('C4. historical transaction unchanged by price edit', Number(hist?.amount) === Number(hist2?.amount), hist?.amount + ' -> ' + hist2?.amount)
  // delete the exception -> back to base
  await svc.from('service_prices').delete().eq('service_id', svcx.id).eq('patient_id', mariaRow.id)
  await svc.from('services').update({ price: BASE_P }).eq('id', svcx.id)
  await login('maria@dentalvibe.ph')
  await pg.goto(BASE + '/book', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1200)
  await pg.locator('main form button[type="button"]').filter({ hasText: svcx.name }).first().click()
  await pg.locator('button:has-text("Next")').last().click(); await pg.waitForTimeout(800)
  check('C5. exception removed -> base price returns', (await txt()).includes('Total₱' + BASE_P.toLocaleString('en-US')), (await txt()).match(/Total₱[\d,]+/)?.[0] ?? 'no total')
  await svc.from('patients').delete().eq('id', p2.id)
  await svc.from('profiles').delete().eq('id', au2.user.id)
  await svc.auth.admin.deleteUser(au2.user.id)
} else check('C. pricing prerequisites (service + both patients)', false, JSON.stringify({ svcx: !!svcx, maria: !!mariaRow, p2: !!p2 }))

// ═══ E. WALK-IN CLAIM — one human, one record (§21 duplicate prevention) ═══
const EEMAIL = 'qaclaim' + TS + '@dentalvibe.ph'
const { data: walkin } = await svc.from('patients').insert({ full_name: 'QA Walkin ' + TS, email: EEMAIL, phone: '+63 911 000 0000', medical_note: 'clinic-entered history' }).select().maybeSingle()
const { data: reg } = await svc.auth.admin.createUser({ email: EEMAIL, password: 'Password123', email_confirm: true, user_metadata: { full_name: 'QA Walkin ' + TS } })
await new Promise((r) => setTimeout(r, 800))
const { data: rows } = await svc.from('patients').select('id, user_id, full_name, phone, medical_note, patient_code').eq('email', EEMAIL)
check('E1. signup CLAIMS the walk-in record (exactly one row)', (rows ?? []).length === 1, 'rows=' + (rows ?? []).length)
check('E2. account linked to the record', rows?.[0]?.user_id === reg?.user?.id, rows?.[0]?.user_id ?? 'none')
check('E3. clinic data preserved (phone + note + code)', rows?.[0]?.phone === '+63 911 000 0000' && rows?.[0]?.medical_note === 'clinic-entered history' && rows?.[0]?.patient_code === walkin?.patient_code, JSON.stringify(rows?.[0] ?? {}).slice(0, 120))
// schema backstop: a direct duplicate insert is impossible
const dup = await svc.from('patients').insert({ full_name: 'Dup ' + TS, email: EEMAIL })
check('E4. unique index blocks duplicates at the schema level', !!dup.error && /ux_patients_email/.test(dup.error.message), dup.error?.code ?? 'INSERTED!')
// fresh email still creates a fresh row
const { data: fresh } = await svc.auth.admin.createUser({ email: 'qafresh' + TS + '@dentalvibe.ph', password: 'Password123', email_confirm: true, user_metadata: { full_name: 'QA Fresh ' + TS } })
const { data: freshRow } = await svc.from('patients').select('id').eq('user_id', fresh.user.id).maybeSingle()
check('E5. fresh registration still creates its own record', !!freshRow)
// cleanup
await svc.from('patients').delete().eq('email', EEMAIL)
await svc.from('patients').delete().eq('user_id', fresh.user.id)
await svc.from('profiles').delete().in('id', [reg.user.id, fresh.user.id])
await svc.auth.admin.deleteUser(reg.user.id)
await svc.auth.admin.deleteUser(fresh.user.id)

// ═══ D. MULTI-TAB (§26) ═══
const tabA = await ctx.newPage()
const tabB = await ctx.newPage()
const quickLogin = async (p, email) => {
  await p.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await p.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  await p.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
  await p.fill('input[type="email"]', email); await p.fill('input[type="password"]', 'password123')
  await p.locator('form button:has-text("Sign In")').last().click(); await p.waitForTimeout(2500)
}
await quickLogin(tabA, 'maria@dentalvibe.ph')
await quickLogin(tabB, 'owner@dentalvibe.ph')
await tabA.reload({ waitUntil: 'networkidle' }); await tabA.waitForTimeout(1500)
const tA = (await tabA.locator('header').textContent()).replace(/\s+/g, ' ')
const tB = (await tabB.locator('header').textContent()).replace(/\s+/g, ' ')
check('D1. patient tab keeps patient after refresh', /Maria/.test(tA), tA.slice(0, 50))
check('D2. owner tab stays owner', /Owner|Dulce/.test(tB), tB.slice(0, 50))

await b.close()
console.log(`\n===== CROSS-ROLE QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
