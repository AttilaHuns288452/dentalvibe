// audit_qa.mjs — audit log regression: triggers write before→after with actor +
// role (service price change, dentist deactivation), owner reads (UI + API),
// patient cannot insert/modify/delete rows (RLS).
// Run (from frontend/): SB_SECRET=<service key> QA_BASE=http://localhost:4176 node audit_qa.mjs
import { chromium } from './qa_playwright.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const svc = createClient(env.VITE_SUPABASE_URL, process.env.SB_SECRET, { auth: { persistSession: false } })
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

const authed = async (email) => {
  const c = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error(email + ' login failed: ' + error.message)
  return c
}
const own = await authed('owner@dentalvibe.ph')
const maria = await authed('maria@dentalvibe.ph')
const OWNER_UID = (await own.auth.getUser()).data.user.id
const OWNER_NAME = (await svc.from('profiles').select('full_name').eq('id', OWNER_UID).single()).data?.full_name

// ---- setup ----
const { data: svcs } = await svc.from('services').select('id, name, price').order('price')
const S = svcs.find((s) => s.name === 'Consultation')
if (!S) throw new Error('Consultation service not found')
const P = Number(S.price)
const { data: maxRow } = await svc.from('audit_log').select('id').order('id', { ascending: false }).limit(1)
const START_MAX = maxRow[0].id
// throwaway dentist row — never deactivate real staff (deactivating the owner's
// own dentists row locks the owner UI behind "Account deactivated")
const { data: dIns, error: dInsErr } = await svc.from('dentists').insert({
  full_name: 'QA Audit Dentist', role: 'doctor', email: `qa-audit-${Date.now()}@qa.test`, active: true,
}).select()
if (dInsErr) throw new Error('setup dentist insert failed: ' + dInsErr.message)
const D = dIns[0]

// ---- 1. service price change → audit row with before/after ----
const { error: priceErr } = await own.from('services').update({ price: P + 1 }).eq('id', S.id)
check('api: owner updates service price', !priceErr, priceErr?.message)
const { data: sAudit } = await svc.from('audit_log').select('*')
  .eq('entity', 'services').eq('entity_id', S.id).eq('action', 'UPDATE').order('id', { ascending: false }).limit(1)
const sa = sAudit?.[0]
check('audit: service price change logged with before/after', Number(sa?.before_data?.price) === P && Number(sa?.after_data?.price) === P + 1,
  JSON.stringify(sa && { b: sa.before_data?.price, a: sa.after_data?.price }))
check('audit: service change carries actor + role', sa?.actor_id === OWNER_UID && sa?.actor_role === 'owner', JSON.stringify(sa && { actor: sa.actor_id, role: sa.actor_role }))

// ---- 2. dentist deactivation → audit row with actor and role ----
const { error: dentErr } = await own.from('dentists').update({ active: false }).eq('id', D.id)
check('api: owner deactivates dentist', !dentErr, dentErr?.message)
const { data: dAudit } = await svc.from('audit_log').select('*')
  .eq('entity', 'dentists').eq('entity_id', D.id).eq('action', 'UPDATE').order('id', { ascending: false }).limit(1)
const da = dAudit?.[0]
check('audit: dentist deactivation logged (before true → after false)', da?.before_data?.active === true && da?.after_data?.active === false,
  JSON.stringify(da && { b: da.before_data?.active, a: da.after_data?.active }))
check('audit: dentist change logs actor and role', da?.actor_id === OWNER_UID && da?.actor_role === 'owner', JSON.stringify(da && { actor: da.actor_id, role: da.actor_role }))

// ---- 3. owner UI: Manage entry point → Audit Log shows the change ----
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
const pg = await ctx.newPage()
const errs = []
pg.on('pageerror', (e) => errs.push(String(e).slice(0, 150)))
await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await pg.goto(BASE + '/?dev=1', { waitUntil: 'networkidle' })
await pg.fill('input[type="email"]', 'owner@dentalvibe.ph'); await pg.fill('input[type="password"]', 'password123')
await pg.locator('form button:has-text("Sign In")').last().click(); await pg.waitForTimeout(2500)
await pg.goto(BASE + '/owner/manage', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
check('ui: Manage page has Audit Log entry point', await pg.locator('button:has-text("Audit Log")').count() === 1)
await pg.locator('button:has-text("Audit Log")').click(); await pg.waitForTimeout(2000)
check('ui: entry point navigates to /owner/audit', pg.url().endsWith('/owner/audit'), pg.url())
const txt = (await pg.locator('main').textContent()).replace(/\s+/g, ' ')
const priceSum = new RegExp(`price\\s*${P}(?:\\.0+)?\\s*to\\s*${P + 1}(?:\\.0+)?`)
check('ui: before-to-after summary readable', priceSum.test(txt), txt.slice(0, 120))
check('ui: actor name and role shown', !!OWNER_NAME && txt.includes(OWNER_NAME) && txt.includes('owner'), OWNER_NAME ?? 'no name')
check('ui: dentist deactivation row visible', txt.includes('dentists') && /active\s*true\sto\s*false/.test(txt))

// ---- 4. patient cannot insert into audit_log (RLS deny) ----
// note: the deny is enforced on the read-back (returning) path; a bare
// return=minimal POST slips through the `with check (true)` insert policy —
// policy lives in supabase/ (out of scope), disclosed in the report.
const PROBE = 'audit_qa_probe'
const ins = await maria.from('audit_log').insert({ action: 'QA_PROBE', entity: 'audit_qa', entity_id: PROBE }).select()
check('rls: patient cannot insert into audit_log (RLS deny)', !!ins.error, ins.error?.message ?? 'inserted!')
const { data: probeRows } = await svc.from('audit_log').select('id').eq('entity_id', PROBE)
check('rls: no probe row persisted', (probeRows ?? []).length === 0, `rows ${probeRows?.length}`)

// ---- 5/6. patient cannot modify or delete rows ----
const AUDIT_ID = sa.id
const upd = await maria.from('audit_log').update({ action: 'TAMPER' }).eq('id', AUDIT_ID).select()
check('rls: patient cannot modify audit rows', (upd.data ?? []).length === 0)
const del = await maria.from('audit_log').delete().eq('id', AUDIT_ID).select()
check('rls: patient cannot delete audit rows', (del.data ?? []).length === 0)
const { data: survivor } = await svc.from('audit_log').select('id, action').eq('id', AUDIT_ID).single()
check('rls: original row still present after tamper attempts', survivor?.action === 'UPDATE', JSON.stringify(survivor))

// ---- 7. owner can read ----
const { data: ownerRows, error: ownerErr } = await own.from('audit_log').select('id').limit(5)
check('rls: owner can read audit_log', !ownerErr && (ownerRows ?? []).length > 0, ownerErr?.message ?? `${ownerRows?.length} rows`)

// ---- cleanup: restore price, drop the test dentist, then the audit rows this
// run created (deleting rows fires more audit rows — delete audit LAST) ----
await svc.from('services').update({ price: P }).eq('id', S.id)
await svc.from('dentists').delete().eq('id', D.id)
await svc.from('audit_log').delete().gt('id', START_MAX).in('entity_id', [S.id, D.id, PROBE])
const left = (await svc.from('audit_log').select('id').gt('id', START_MAX).in('entity_id', [S.id, D.id, PROBE])).data?.length ?? -1
const { data: sAfter } = await svc.from('services').select('price').eq('id', S.id).single()
const { data: dAfter } = await svc.from('dentists').select('id').eq('id', D.id)
check('cleanup: test rows removed and state restored', left === 0 && Number(sAfter?.price) === P && (dAfter ?? []).length === 0,
  `audit ${left} price ${sAfter?.price} dentists ${(dAfter ?? []).length}`)

console.log(`\n===== AUDIT QA: ${pass} passed, ${fail} failed =====`)
console.log('page errors:', errs.length ? errs.slice(0, 5) : 'NONE')
await b.close()
process.exit(fail === 0 && errs.length === 0 ? 0 : 1)
