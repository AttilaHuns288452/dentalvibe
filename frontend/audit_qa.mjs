// audit_qa.mjs — audit log regression: triggers write before→after with actor +
// role (service price change, dentist deactivation, EHR attachments, record
// categories, clinic settings, service lifecycle, finance corrections/voids),
// owner reads (UI + API), patient cannot read/insert/modify/delete rows (RLS).
// Run (from frontend/): SB_SECRET=<service key> QA_BASE=http://localhost:4176 node audit_qa.mjs
import { chromium } from './qa_playwright.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const BASE = process.env.QA_BASE || 'http://localhost:4176'
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
if (!process.env.SB_SECRET) { console.error('FAIL SB_SECRET env var missing'); process.exit(1) }
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
const MARIA_PID = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').single()).data?.id
const { data: maxRow } = await svc.from('audit_log').select('id').order('id', { ascending: false }).limit(1)
const START_MAX = maxRow[0].id
const touched = [S.id] // entity_ids whose audit rows this run created (cleaned up last)
// throwaway dentist row — never deactivate real staff (deactivating the owner's
// own dentists row locks the owner UI behind "Account deactivated")
const { data: dIns, error: dInsErr } = await svc.from('dentists').insert({
  full_name: 'QA Audit Dentist', role: 'doctor', email: `qa-audit-${Date.now()}@qa.test`, active: true,
}).select()
if (dInsErr) throw new Error('setup dentist insert failed: ' + dInsErr.message)
const D = dIns[0]
touched.push(D.id)
// last audit row for an entity (whatever the operation)
const lastAudit = async (entity, entityId, action) => {
  let q = svc.from('audit_log').select('*').eq('entity', entity).eq('entity_id', String(entityId))
  if (action) q = q.eq('action', action)
  const { data } = await q.order('id', { ascending: false }).limit(1)
  return data?.[0]
}

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

// ---- 4. patient cannot insert into audit_log (RLS deny; 0027 insert check(false)) ----
const PROBE = 'audit_qa_probe'
const ins = await maria.from('audit_log').insert({ action: 'QA_PROBE', entity: 'audit_qa', entity_id: PROBE }).select()
check('rls: patient cannot insert into audit_log (RLS deny)', !!ins.error, ins.error?.message ?? 'inserted!')
// §3 release gate: NO client role may forge audit rows — generation is
// trigger/SECURITY-DEFINER only (0033 dropped every client INSERT policy)
const { createClient: cc } = await import('@supabase/supabase-js')
const mkC = async (email) => { const c = cc(process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY); await c.auth.signInWithPassword({ email, password: 'password123' }); return c }
for (const [who, email] of [['doctor', 'doctor@dentalvibe.ph'], ['owner', 'owner@dentalvibe.ph']]) {
  const c = await mkC(email)
  const r = await c.from('audit_log').insert({ action: 'QA_PROBE', entity: 'audit_qa', entity_id: PROBE }).select()
  check(`rls: ${who} cannot insert into audit_log (trigger-only generation)`, !!r.error, r.error?.message ?? 'inserted!')
}
const gateUpd = await (await mkC('owner@dentalvibe.ph')).from('audit_log').update({ action: 'TAMPERED' }).eq('entity_id', PROBE)
check('rls: owner cannot UPDATE audit_log', (gateUpd.data ?? []).length === 0 && !gateUpd.error, JSON.stringify(gateUpd.error ?? gateUpd.data))
const gateDel = await (await mkC('owner@dentalvibe.ph')).from('audit_log').delete().eq('entity_id', PROBE)
check('rls: owner cannot DELETE audit_log', (gateDel.data ?? []).length === 0 && !gateDel.error, JSON.stringify(gateDel.error ?? gateDel.data))
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

// ---- 7. owner can read; patient cannot even read ----
const { data: ownerRows, error: ownerErr } = await own.from('audit_log').select('id').limit(5)
check('rls: owner can read audit_log', !ownerErr && (ownerRows ?? []).length > 0, ownerErr?.message ?? `${ownerRows?.length} rows`)
const patientRead = await maria.from('audit_log').select('id').limit(5)
check('rls: patient cannot read audit rows', !patientRead.error && (patientRead.data ?? []).length === 0,
  patientRead.error?.message ?? `rows ${patientRead.data?.length}`)

// ---- 8. EHR attachment upload + delete → 'ehr_attachment' audit rows ----
{
  const ehrName = `auditqa-${Date.now()}.png`
  const up = await own.from('ehr_attachments')
    .insert({ patient_id: MARIA_PID, category: 'X-Ray', filename: ehrName, file_size: '0.1 MB', note: 'audit_qa probe' })
    .select()
  check('api: owner uploads EHR attachment', !up.error && !!up.data?.[0]?.id, up.error?.message)
  const eid = up.data?.[0]?.id
  if (eid) touched.push(eid)
  const a1 = await lastAudit('ehr_attachments', eid, 'INSERT')
  check('audit: EHR attachment upload logged (ehr_attachment row, after_data)',
    a1?.entity === 'ehr_attachments' && a1?.action === 'INSERT' && !!a1?.after_data && a1?.before_data == null,
    JSON.stringify(a1 && { action: a1.action, entity: a1.entity }))
  check('audit: EHR attachment row carries actor + role', a1?.actor_id === OWNER_UID && a1?.actor_role === 'owner',
    JSON.stringify(a1 && { actor: a1.actor_id, role: a1.actor_role }))
  await own.from('ehr_attachments').delete().eq('id', eid)
  const a2 = await lastAudit('ehr_attachments', eid, 'DELETE')
  check('audit: EHR attachment delete logged (ehr_attachment row, before_data)',
    a2?.entity === 'ehr_attachments' && a2?.action === 'DELETE' && !!a2?.before_data && a2?.after_data == null
      && a2?.before_data?.filename === ehrName,
    JSON.stringify(a2 && { action: a2.action, b: a2.before_data?.filename }))
}

// ---- 9. record category create/edit/delete audited ----
{
  const catName = `QA Audit Cat ${Date.now()}`
  const up = await own.from('record_categories').insert({ name: catName, sort_order: 99 }).select()
  check('api: owner creates record category', !up.error && !!up.data?.[0]?.id, up.error?.message)
  const cid = up.data?.[0]?.id
  if (cid) touched.push(cid)
  const a1 = await lastAudit('record_categories', cid, 'INSERT')
  check('audit: record_category create logged', a1?.action === 'INSERT' && a1?.after_data?.name === catName,
    JSON.stringify(a1 && { action: a1.action, name: a1.after_data?.name }))
  await own.from('record_categories').update({ name: catName + ' v2', active: false }).eq('id', cid)
  const a2 = await lastAudit('record_categories', cid, 'UPDATE')
  check('audit: record_category edit logged with before/after',
    a2?.before_data?.name === catName && a2?.after_data?.name === catName + ' v2' && a2?.after_data?.active === false,
    JSON.stringify(a2 && { b: a2.before_data?.name, a: a2.after_data?.name, active: a2.after_data?.active }))
  await own.from('record_categories').delete().eq('id', cid)
  const a3 = await lastAudit('record_categories', cid, 'DELETE')
  check('audit: record_category delete logged with before_data', a3?.action === 'DELETE' && a3?.before_data?.name === catName + ' v2',
    JSON.stringify(a3 && { action: a3.action, b: a3.before_data?.name }))
}

// ---- 10. clinic_settings change (name/hours/open_days) audited with before/after ----
{
  const orig = (await svc.from('clinic_settings').select('*').limit(1)).data[0]
  const NEW = { clinic_name: 'QA Audit Clinic', open_time: '09:00', close_time: '18:00', open_days: ['Mon', 'Wed', 'Fri'] }
  const { error } = await own.from('clinic_settings').update(NEW).eq('id', orig.id)
  check('api: owner updates clinic_settings name/hours/open_days', !error, error?.message)
  const a1 = await lastAudit('clinic_settings', orig.id, 'UPDATE')
  check('audit: clinic_settings change logged with before/after (name/hours/open_days)',
    a1?.before_data?.clinic_name === orig.clinic_name && a1?.after_data?.clinic_name === NEW.clinic_name
      && a1?.before_data?.open_time === orig.open_time && a1?.after_data?.open_time === NEW.open_time
      && a1?.before_data?.close_time === orig.close_time && a1?.after_data?.close_time === NEW.close_time
      && JSON.stringify(a1?.after_data?.open_days) === JSON.stringify(NEW.open_days)
      && JSON.stringify(a1?.before_data?.open_days) === JSON.stringify(orig.open_days),
    JSON.stringify(a1 && { b: a1.before_data?.clinic_name, a: a1.after_data?.clinic_name }))
  await own.from('clinic_settings').update({
    clinic_name: orig.clinic_name, open_time: orig.open_time, close_time: orig.close_time, open_days: orig.open_days,
  }).eq('id', orig.id)
  const after = (await svc.from('clinic_settings').select('*').eq('id', orig.id).single()).data
  check('cleanup: clinic_settings restored',
    after?.clinic_name === orig.clinic_name && after?.open_time === orig.open_time && after?.close_time === orig.close_time
      && JSON.stringify(after?.open_days) === JSON.stringify(orig.open_days),
    JSON.stringify(after && { name: after.clinic_name, open: after.open_time }))
}

// ---- 11. service created / edited / deactivated audited ----
{
  const svcName = `QA Audit Svc ${Date.now()}`
  const up = await own.from('services').insert({ name: svcName, price: 150, duration_minutes: 30 }).select()
  check('api: owner creates service', !up.error && !!up.data?.[0]?.id, up.error?.message)
  const vid = up.data?.[0]?.id
  if (vid) touched.push(vid)
  const a1 = await lastAudit('services', vid, 'INSERT')
  check('audit: service create logged', a1?.action === 'INSERT' && Number(a1?.after_data?.price) === 150,
    JSON.stringify(a1 && { action: a1.action, price: a1.after_data?.price }))
  await own.from('services').update({ price: 200 }).eq('id', vid)
  const a2 = await lastAudit('services', vid, 'UPDATE')
  check('audit: service edit logged with before/after', Number(a2?.before_data?.price) === 150 && Number(a2?.after_data?.price) === 200,
    JSON.stringify(a2 && { b: a2.before_data?.price, a: a2.after_data?.price }))
  await own.from('services').update({ active: false }).eq('id', vid)
  const a3 = await lastAudit('services', vid, 'UPDATE')
  check('audit: service deactivation logged (before true → after false)',
    a3?.before_data?.active === true && a3?.after_data?.active === false,
    JSON.stringify(a3 && { b: a3.before_data?.active, a: a3.after_data?.active }))
  await svc.from('services').delete().eq('id', vid)
}

// ---- 12. finance correction + void audited (owner-only, reason required) ----
{
  const txIns = await own.from('transactions').insert({
    type: 'income', category: 'Service', amount: 100, patient_name: 'QA Audit Patient',
    description: 'audit_qa probe', entry_date: new Date().toISOString().slice(0, 10),
  }).select()
  check('api: owner records a transaction', !txIns.error && !!txIns.data?.[0]?.id, txIns.error?.message)
  const tx = txIns.data?.[0]?.id
  if (tx) touched.push(tx)
  const c = await own.rpc('fn_correct_transaction', { p_tx: tx, p_new_amount: 250, p_reason: 'audit_qa correction probe' })
  const a1 = await lastAudit('transactions', tx, 'CORRECT')
  check('audit: finance correction logged with before/after + reason',
    !c.error && a1?.action === 'CORRECT' && Number(a1?.before_data?.amount) === 100 && Number(a1?.after_data?.amount) === 250
      && a1?.reason === 'audit_qa correction probe',
    c.error?.message ?? JSON.stringify(a1 && { b: a1.before_data?.amount, a: a1.after_data?.amount, reason: a1.reason }))
  const v = await own.rpc('fn_void_transaction', { p_tx: tx, p_reason: 'audit_qa void probe' })
  const a2 = await lastAudit('transactions', tx, 'VOID')
  check('audit: finance void logged with before/after + reason',
    !v.error && a2?.action === 'VOID' && a2?.after_data?.voided === true && a2?.reason === 'audit_qa void probe',
    v.error?.message ?? JSON.stringify(a2 && { a: a2.after_data, reason: a2.reason }))
  await svc.from('transactions').delete().eq('id', tx)
}

// ---- cleanup: restore price, drop the test rows, then the audit rows this
// run created (deleting rows fires more audit rows — delete audit LAST) ----
await svc.from('services').update({ price: P }).eq('id', S.id)
await svc.from('dentists').delete().eq('id', D.id)
await svc.from('audit_log').delete().gt('id', START_MAX).in('entity_id', touched.map(String))
const left = (await svc.from('audit_log').select('id').gt('id', START_MAX).in('entity_id', touched.map(String))).data?.length ?? -1
const { data: sAfter } = await svc.from('services').select('price').eq('id', S.id).single()
const { data: dAfter } = await svc.from('dentists').select('id').eq('id', D.id)
check('cleanup: test rows removed and state restored', left === 0 && Number(sAfter?.price) === P && (dAfter ?? []).length === 0,
  `audit ${left} price ${sAfter?.price} dentists ${(dAfter ?? []).length}`)

console.log(`\n===== AUDIT QA: ${pass} passed, ${fail} failed =====`)
console.log('page errors:', errs.length ? errs.slice(0, 5) : 'NONE')
await b.close()
process.exit(fail === 0 && errs.length === 0 ? 0 : 1)
