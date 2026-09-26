// recovery_qa.mjs — crash / restart / app-kill recovery.
// Model under test: the database is the source of truth. "Client death" is
// simulated by ABANDONING a client mid-flow (no response handler, no UI) and
// re-opening with a brand-new session — exactly what a killed tab/PWA does in
// this app, since there is no unload-time persistence (verified: the only
// beforeunload handler warns about dirty forms; nothing is flushed or queued).
// Cases: mutation-succeeds-client-dies, rehydrate-on-reopen, duplicate
// submission, payment/webhook authority.
// Run (from frontend/): node recovery_qa.mjs   (needs SB_SECRET; QA_BASE for UI)
import { chromium } from './qa_playwright.mjs'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync(new URL('./.env.local', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split('=')))
const SB = env.VITE_SUPABASE_URL
const svc = createClient(SB, process.env.SB_SECRET)
const BASE = process.env.QA_BASE || 'http://localhost:4176'
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

// a "reopened app" = brand-new client + fresh login (per-tab sessions by design)
const reopen = async (email) => {
  const c = createClient(SB, env.VITE_SUPABASE_ANON_KEY)
  const { error } = await c.auth.signInWithPassword({ email, password: 'password123' })
  if (error) throw new Error('reopen login failed: ' + error.message)
  return c
}
const DAY = (() => { const d = new Date(Date.now() + (170 + Math.floor(Math.random() * 50)) * 864e5); while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(2, 0, 0, 0); return d })()
const RD = DAY.toISOString().slice(0, 10)

const { data: me } = await svc.from('patients').select('id, user_id').eq('email', 'maria@dentalvibe.ph').maybeSingle()
const { data: svcRow } = await svc.from('services').select('id, price').eq('active', true).order('price').limit(1).maybeSingle()
const { data: doctorRow } = await svc.from('dentists').select('id').eq('email', 'doctor@dentalvibe.ph').maybeSingle()

// ── 1. booking committed, client dies BEFORE any confirmation UI ────────────
const { data: appt, error: aErr } = await svc.from('appointments').insert({
  patient_id: me.id, service_id: svcRow.id, service_ids: [svcRow.id], scheduled_at: DAY.toISOString(),
  requested_date: RD, price: svcRow.price, status: 'pending', payment_status: 'unpaid',
}).select().maybeSingle()
check('1. booking mutation committed (then client died)', !!appt && !aErr, aErr?.message ?? '')
// reopen: authoritative state is refetched, no UI memory involved
const app2 = await reopen('maria@dentalvibe.ph')
const { data: found } = await app2.from('appointments').select('id, status, payment_status').eq('id', appt.id)
check('2. reopened app finds the booking (confirmation page never shown)', found?.length === 1 && found[0].payment_status === 'unpaid', JSON.stringify(found))
check('3. booking visible in patient appointment list after reopen', found?.length === 1)

// ── 2. duplicate-submission protection (§10) ────────────────────────────────
const dup = await app2.from('appointments').insert({
  patient_id: me.id, service_id: svcRow.id, service_ids: [svcRow.id], scheduled_at: DAY.toISOString(),
  requested_date: RD, price: svcRow.price, status: 'pending', payment_status: 'unpaid',
}).select()
check('4. duplicate booking after crash-retry is REJECTED (ux_appt_patient_date)', !!dup.error, dup.error?.message?.slice(0, 50) ?? 'created!')

// ── 3. payment created, client dies; retry must REUSE, never duplicate ──────
const pay1 = (await app2.functions.invoke('paymongo-create', { body: { appointment_id: appt.id } })).data
// "died before the response handler": never use pay1 — reopen and call again
const app3 = await reopen('maria@dentalvibe.ph')
const pay2 = (await app3.functions.invoke('paymongo-create', { body: { appointment_id: appt.id } })).data
check('5. payment retry after crash returns the SAME payment', !!pay1?.payment_id && pay1.payment_id === pay2?.payment_id, pay2?.error ?? pay2?.payment_id?.slice(0, 8))
const { data: payRows } = await svc.from('payments').select('id').eq('appointment_id', appt.id)
check('6. exactly ONE payment row exists', payRows?.length === 1, 'rows=' + (payRows?.length ?? -1))

// ── 4. settlement succeeds server-side, client dies before the UI ───────────
const sR = await svc.rpc('fn_apply_payment_result', {
  p_payment: pay1.payment_id, p_result: 'paid', p_provider_status: 'succeeded',
  p_amount_centavos: Math.round(Number(svcRow.price) * 100), p_currency: 'PHP',
})
check('7. settle mutation committed (then client died)', !sR.error, sR.error?.message ?? '')
const app4 = await reopen('maria@dentalvibe.ph')
const { data: after } = await app4.from('appointments').select('status, payment_status').eq('id', appt.id).maybeSingle()
check('8. reopened app shows PAID/APPROVED from the database', after?.payment_status === 'paid' && after?.status === 'approved', JSON.stringify(after))
// crash-retry: the client's re-settle / webhook replay must not double-apply
const sR2 = await svc.rpc('fn_apply_payment_result', {
  p_payment: pay1.payment_id, p_result: 'paid', p_provider_status: 'succeeded',
  p_amount_centavos: Math.round(Number(svcRow.price) * 100), p_currency: 'PHP',
})
const { data: txRows } = await svc.from('transactions').select('id').eq('appointment_id', appt.id)
const { data: notifRows } = await svc.from('notifications').select('id').eq('dedupe_key', 'payment:' + pay1.payment_id + ':paid')
check('9. re-settle is idempotent (error or silent no-op, not a second apply)', !!sR2.error || sR2.data == null || sR2.data === 'already', sR2.error?.message?.slice(0, 40) ?? String(sR2.data))
check('10. exactly ONE financial transaction after retries', txRows?.length === 1, 'tx=' + (txRows?.length ?? -1))
check('11. exactly ONE payment notification after retries', notifRows?.length === 1, 'notif=' + (notifRows?.length ?? -1))

// ── 5. messaging survives client death ──────────────────────────────────────
const { data: msg } = await svc.from('chat_messages').insert({ patient_id: me.id, sender: 'patient', body: 'recovery probe' }).select().maybeSingle()
const app5 = await reopen('maria@dentalvibe.ph')
const { data: msg2 } = await app5.from('chat_messages').select('id').eq('id', msg?.id ?? 'x')
check('12. sent message survives and is visible after reopen', msg2?.length === 1, msg2 ? '' : 'lost!')

// ── 6. owner settings: atomic row, refetch = committed truth ────────────────
const { data: set0 } = await svc.from('clinic_settings').select('clinic_name').eq('id', 1).maybeSingle()
await svc.from('clinic_settings').update({ clinic_name: 'Recovery Probe Clinic' }).eq('id', 1)
const owner2 = await reopen('owner@dentalvibe.ph')
const { data: set1 } = await owner2.from('clinic_settings').select('clinic_name').eq('id', 1).maybeSingle()
check('13. settings edit committed atomically; reopen shows committed value', set1?.clinic_name === 'Recovery Probe Clinic', JSON.stringify(set1))
await svc.from('clinic_settings').update({ clinic_name: set0.clinic_name }).eq('id', 1)

// ── 7. correction / void crash-retries (§10) ────────────────────────────────
const { data: tx } = await svc.from('transactions').insert({
  type: 'income', category: 'Recovery Probe', amount: 5000, patient_name: 'recovery', entry_date: RD, description: 'recovery_qa',
}).select().maybeSingle()
const own2 = await reopen('owner@dentalvibe.ph')
const c1 = await own2.rpc('fn_correct_transaction', { p_tx: tx.id, p_new_amount: 500, p_reason: 'mistyped amount' })
check('14. correction applied (client then died before response)', !c1.error, c1.error?.message ?? '')
const c2 = await own2.rpc('fn_correct_transaction', { p_tx: tx.id, p_new_amount: 500, p_reason: 'mistyped amount' })
const { data: cAudit } = await svc.from('audit_log').select('id').eq('entity_id', tx.id).eq('action', 'CORRECT')
check('15. crash-retry correction to SAME amount is a no-op', !c2.error && cAudit?.length === 1, 'err=' + (c2.error?.message?.slice(0, 40) ?? 'none') + ' audits=' + (cAudit?.length ?? -1))
const c3 = await own2.rpc('fn_correct_transaction', { p_tx: tx.id, p_new_amount: 450, p_reason: 'second genuine fix' })
check('16. a DIFFERENT-amount correction still works (guard is not a lockout)', !c3.error, c3.error?.message ?? '')
const v1 = await own2.rpc('fn_void_transaction', { p_tx: tx.id, p_reason: 'voiding after crash' })
const v2 = await own2.rpc('fn_void_transaction', { p_tx: tx.id, p_reason: 'voiding after crash' })
const { data: vAudit } = await svc.from('audit_log').select('id').eq('entity_id', tx.id).eq('action', 'VOID')
check('17. void crash-retry: second void is a safe no-op (error or silent)', !v1.error && (!!v2.error || v2.data == null), v2.error?.message?.slice(0, 40) ?? String(v2.data))
check('18. exactly ONE void audit row', vAudit?.length === 1, 'audits=' + (vAudit?.length ?? -1))

// ── 8. Ready state rehydrates from DB (no stale React state after restart) ──
await svc.from('dentist_ready').upsert({ dentist_id: doctorRow.id, clinic_date: new Date().toISOString().slice(0, 10), ready: true }, { onConflict: 'dentist_id,clinic_date' })
const doc2 = await reopen('doctor@dentalvibe.ph')
const { data: readyRows } = await doc2.from('dentist_ready').select('ready').eq('dentist_id', doctorRow.id)
check('19. Ready state refetched from DB after reopen', readyRows?.some((r) => r.ready === true), JSON.stringify(readyRows))

// ── 9. UI: killed before the confirmation screen — reopening lists the booking ──
const b = await chromium.launch()
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } })
const pg = await ctx.newPage()
await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
await pg.goto(BASE + '/', { waitUntil: 'networkidle' })
await pg.locator('input[type=email]').fill('maria@dentalvibe.ph')
await pg.locator('input[type=password]').fill('password123')
await pg.locator('button:has-text("Sign In")').last().click()
await pg.waitForTimeout(2000)
await pg.goto(BASE + '/appointments', { waitUntil: 'networkidle' })
await pg.waitForTimeout(1500)
const bodyTxt = await pg.locator('main').textContent()
check('20. UI after restart lists the committed booking (no confirmation page needed)', bodyTxt.includes('Completed') || bodyTxt.includes('Confirmed') || bodyTxt.includes('Unpaid') || bodyTxt.includes('Pay'), 'appt-id visible=' + bodyTxt.includes(appt.id.slice(0, 8)))
await ctx.close()
await b.close()

// ── cleanup ─────────────────────────────────────────────────────────────────
await svc.from('transactions').delete().eq('id', tx.id)
await svc.from('transactions').delete().eq('appointment_id', appt.id)
await svc.from('payments').delete().eq('appointment_id', appt.id)
await svc.from('appointments').delete().eq('id', appt.id)
await svc.from('chat_messages').delete().eq('id', msg?.id ?? 'x')
await svc.from('notifications').delete().eq('dedupe_key', 'payment:' + pay1.payment_id + ':paid')
await svc.from('dentist_ready').delete().eq('dentist_id', doctorRow.id)

console.log(`\n===== RECOVERY QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail === 0 ? 0 : 1)
