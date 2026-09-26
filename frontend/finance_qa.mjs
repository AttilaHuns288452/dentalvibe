// finance_qa.mjs — finance correction/void regression: owner UI flow (correct +
// void with reasons), RPC validation (reason/amount/voided/non-owner), appointment
// payment rows can't be duplicated, totals recompute, audit before→after + reason,
// RLS (patient can't read audit_log or update transactions).
// Run (from frontend/): SB_SECRET=<service key> QA_BASE=http://localhost:4176 node finance_qa.mjs
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
const doc = await authed('doctor@dentalvibe.ph')
const maria = await authed('maria@dentalvibe.ph')

// ---- setup: one manual income transaction to correct/void ----
const TODAY = new Date().toISOString().slice(0, 10)
const { data: ins, error: insErr } = await svc.from('transactions').insert({
  type: 'income', category: 'QA Finance', amount: 5000, patient_name: 'QA Finance Test',
  description: 'finance_qa', entry_date: TODAY,
}).select()
if (insErr) throw new Error('setup insert failed: ' + insErr.message)
const TX = ins[0].id
const { data: plRows } = await svc.from('transactions').select('id, amount, payment_id, appointment_id')
  .not('payment_id', 'is', null).limit(1)
const PL = plRows?.[0]
if (!PL) throw new Error('no payment-linked transaction to test against')

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
const pesoNum = (s) => Number((s.match(/₱([\d,]+)/) ?? [0, '0'])[1].replace(/,/g, ''))
const incomeTotal = async () => pesoNum((await txt()).match(/Income This Month\s*₱[\d,]+/)?.[0] ?? '₱0')
const row = (id) => pg.locator(`[data-tx="${id}"]`)
const rowText = async (id) => (await row(id).textContent()).replace(/\s+/g, ' ')
const dlg = () => pg.locator('[role="dialog"]')

// ---- 1. owner UI: correct 5000 → 500 with reason ----
await login('owner@dentalvibe.ph')
await pg.goto(BASE + '/owner/income', { waitUntil: 'networkidle' }); await pg.waitForTimeout(1500)
await pg.locator('button:has-text("Transactions")').click(); await pg.waitForTimeout(1500)
check('ui: manual transaction listed', await row(TX).count() === 1)
const t0 = await incomeTotal()
await row(TX).locator('button[aria-label="Correct transaction"]').click(); await pg.waitForTimeout(600)
await dlg().getByLabel('New amount').fill('500')
await dlg().getByLabel('Reason').fill('typo in amount')
await dlg().locator('button:has-text("Save correction")').click(); await pg.waitForTimeout(2000)
const after1 = (await svc.from('transactions').select('amount, correction_reason').eq('id', TX).single()).data
check('ui: owner corrects 5000 to 500 with reason', Number(after1?.amount) === 500 && after1?.correction_reason === 'typo in amount', JSON.stringify(after1))
const t1 = await incomeTotal()
check('ui: corrected totals update (5000→500)', t1 === t0 - 4500, `before ${t0} after ${t1}`)
check('ui: "Corrected from old amount, reason" note shown', (await rowText(TX)).includes('Corrected from ₱5,000, typo in amount'), (await rowText(TX)).slice(0, 120))

// ---- 2. error surfacing in the correct modal ----
await row(TX).locator('button[aria-label="Correct transaction"]').click(); await pg.waitForTimeout(600)
await dlg().getByLabel('New amount').fill('0')
await dlg().getByLabel('Reason').fill('zero test')
await dlg().locator('button:has-text("Save correction")').click(); await pg.waitForTimeout(800)
check('ui: invalid amount surfaces an error', (await dlg().textContent()).includes('valid amount'))
await dlg().getByLabel('New amount').fill('600')
await dlg().getByLabel('Reason').fill('')
await dlg().locator('button:has-text("Save correction")').click(); await pg.waitForTimeout(800)
check('ui: missing reason rejected in modal', (await dlg().textContent()).includes('Reason is required'))
await dlg().locator('button:has-text("Cancel")').click(); await pg.waitForTimeout(500)

// ---- 3. owner UI: void with reason → struck, out of totals ----
await row(TX).locator('button[aria-label="Void transaction"]').click(); await pg.waitForTimeout(600)
await dlg().getByLabel('Reason').fill('duplicate entry')
await dlg().locator('button:has-text("Confirm void")').click(); await pg.waitForTimeout(2000)
const after2 = (await svc.from('transactions').select('voided_at, correction_reason').eq('id', TX).single()).data
check('ui: void sets voided_at + reason', !!after2?.voided_at && after2?.correction_reason === 'duplicate entry', JSON.stringify(after2))
const t2 = await incomeTotal()
check('ui: voided row excluded from totals', t2 === t1 - 500, `before ${t1} after ${t2}`)
check('ui: voided row shown struck', (await row(TX).locator('.line-through').count()) >= 1 && (await rowText(TX)).includes('Voided — duplicate entry'))

// error surfacing: correcting a voided row reports the RPC error
await row(TX).locator('button[aria-label="Correct transaction"]').click(); await pg.waitForTimeout(600)
await dlg().getByLabel('New amount').fill('500')
await dlg().getByLabel('Reason').fill('try again')
await dlg().locator('button:has-text("Save correction")').click(); await pg.waitForTimeout(1200)
check('ui: correcting voided row surfaces "transaction is voided"', (await dlg().textContent()).includes('transaction is voided'))
await dlg().locator('button:has-text("Cancel")').click(); await pg.waitForTimeout(500)

// ---- 4. RPC validation (API level) ----
const rpc = async (c, fn, args) => (await c.rpc(fn, args)).error?.message ?? null
check('rpc: missing reason rejected', (await rpc(own, 'fn_correct_transaction', { p_tx: TX, p_new_amount: 100, p_reason: '' }) ?? '').includes('correction reason required'))
check('rpc: short reason rejected', (await rpc(own, 'fn_correct_transaction', { p_tx: TX, p_new_amount: 100, p_reason: 'ab' }) ?? '').includes('correction reason required'))
check('rpc: invalid amount 0 rejected', (await rpc(own, 'fn_correct_transaction', { p_tx: TX, p_new_amount: 0, p_reason: 'zero' }) ?? '').includes('invalid amount'))
check('rpc: invalid amount -5 rejected', (await rpc(own, 'fn_correct_transaction', { p_tx: TX, p_new_amount: -5, p_reason: 'negative' }) ?? '').includes('invalid amount'))
check('rpc: voided transaction rejected', (await rpc(own, 'fn_correct_transaction', { p_tx: TX, p_new_amount: 100, p_reason: 'late fix' }) ?? '').includes('transaction is voided'))
check('rpc: patient cannot correct', (await rpc(maria, 'fn_correct_transaction', { p_tx: TX, p_new_amount: 1, p_reason: 'hack' }) ?? '').includes('not authorized'))
check('rpc: doctor cannot void', (await rpc(doc, 'fn_void_transaction', { p_tx: TX, p_reason: 'hack' }) ?? '').includes('not authorized'))

// ---- 5. appointment-linked payment transaction cannot be duplicated ----
const dup = await svc.from('transactions').insert({
  type: 'income', category: 'QA Finance', amount: PL.amount, patient_name: 'QA Dup',
  description: 'finance_qa dup', entry_date: TODAY, payment_id: PL.payment_id,
}).select()
check('payment-linked: second row with same payment_id fails', !!dup.error, dup.error?.message ?? 'inserted!')
const { data: plList } = await svc.from('transactions').select('id').eq('payment_id', PL.payment_id)
check('payment-linked: totals show exactly one row', plList?.length === 1, `rows ${plList?.length}`)
check('payment-linked: UI shows "linked to payment" hint', (await rowText(PL.id)).includes('linked to payment'), (await rowText(PL.id)).slice(0, 100))

// ---- 6. RLS: patient can't read audit_log or update transactions ----
const { data: patAudit } = await maria.from('audit_log').select('id')
check('rls: patient cannot read audit_log (0 rows)', (patAudit ?? []).length === 0)
const { data: patUpd } = await maria.from('transactions').update({ description: 'hacked' }).eq('id', PL.id).select()
check('rls: patient cannot update transactions', (patUpd ?? []).length === 0)
const { data: plAfter } = await svc.from('transactions').select('description').eq('id', PL.id).single()
check('rls: transaction unchanged after patient update', plAfter?.description !== 'hacked')

// ---- 7. audit row has before/after plus reason ----
const { data: corr } = await svc.from('audit_log').select('*').eq('action', 'CORRECT').eq('entity_id', TX).limit(1)
const c0 = corr?.[0]
check('audit: CORRECT row has before/after + reason', Number(c0?.before_data?.amount) === 5000 && Number(c0?.after_data?.amount) === 500 && c0?.reason === 'typo in amount', JSON.stringify(c0 && { b: c0.before_data, a: c0.after_data, r: c0.reason }))
const { data: voids } = await svc.from('audit_log').select('*').eq('action', 'VOID').eq('entity_id', TX).limit(1)
check('audit: VOID row has reason', voids?.[0]?.reason === 'duplicate entry', JSON.stringify(voids?.[0]?.reason))

// ---- cleanup ----
await svc.from('transactions').delete().eq('description', 'finance_qa dup') // only if the dup insert misbehaved
await svc.from('transactions').delete().eq('id', TX)
await svc.from('audit_log').delete().eq('entity_id', TX) // after the row delete — the DELETE fires one more audit row
const leftTx = (await svc.from('transactions').select('id').eq('id', TX)).data?.length ?? -1
const leftAudit = (await svc.from('audit_log').select('id').eq('entity_id', TX)).data?.length ?? -1
check('cleanup: test rows removed', leftTx === 0 && leftAudit === 0, `tx ${leftTx} audit ${leftAudit}`)

console.log(`\n===== FINANCE QA: ${pass} passed, ${fail} failed =====`)
console.log('page errors:', errs.length ? errs.slice(0, 5) : 'NONE')
await b.close()
process.exit(fail === 0 && errs.length === 0 ? 0 : 1)
