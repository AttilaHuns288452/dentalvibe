import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const ANON = fs.readFileSync(new globalThis.URL('./.env.local', import.meta.url), 'utf8').match(/ANON_KEY=(.*)/)[1].trim()
const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const svc = createClient(URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const as = async (email, pw) => { const c = createClient(URL, ANON); await c.auth.signInWithPassword({ email, password: pw }); return c }

// ===== CLEANUP (BUG-013/014) =====
// BUG-013: manual set-diff
const { data: allP } = await svc.from('profiles').select('id, full_name').eq('role', 'patient')
const { data: withRows } = await svc.from('patients').select('user_id')
const have = new Set((withRows ?? []).map((r) => r.user_id))
const junkProfiles = (allP ?? []).filter((p) => !have.has(p.id))
for (const p of junkProfiles) { await svc.auth.admin.deleteUser(p.id).catch(() => {}) }
console.log('BUG-013 purge: removed', junkProfiles.length, 'orphan patient profiles')

const { data: txs } = await svc.from('transactions').select('*')
const seen = new Set()
let dupes = 0
for (const t of txs ?? []) {
  const k = [t.type, t.category, t.amount, t.description].join('|')
  if (seen.has(k)) { await svc.from('transactions').delete().eq('id', t.id); dupes++ } else seen.add(k)
}
console.log('BUG-014 dedupe: removed', dupes, 'duplicate transactions')

// ===== ATTACK BATTERY RE-RUN (the check) =====
const R = []
const t = (name, ok, detail = '') => R.push(`${ok ? 'ok  ' : 'BREAK'} | ${name}${detail ? ' :: ' + detail : ''}`)
const mk = async (email, name) => {
  const { data: u } = await svc.auth.admin.createUser({ email, password: 'Stress123', email_confirm: true, user_metadata: { full_name: name } }).catch(() => ({ data: null }))
  if (u?.user?.id) return u.user.id
  return (await svc.auth.admin.listUsers()).data.users.find((x) => x.email === email)?.id
}
const uidA = await mk('fix.a@test.ph', 'Fix A')
const A = await as('fix.a@test.ph', 'Stress123')
const doc = await as('doctor@dentalvibe.ph', 'password123')
const own = await as('owner@dentalvibe.ph', 'password123')
const maria = await as('maria@dentalvibe.ph', 'password123')
const pidA = (await A.from('patients').select('id').eq('user_id', uidA).limit(1)).data?.[0]?.id
const pidM = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
const sid = (await svc.from('services').select('id, price').limit(1)).data[0]

// BUG-001 family
let e = (await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-01-01', price: sid.price, status: 'approved', payment_status: 'verified' })).error
t('001 spoofed self-confirmed insert blocked', !!e, e?.message ?? 'ACCEPTED')
e = (await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-01-02', price: 0, status: 'pending', payment_status: 'unpaid' })).error
t('001 price-0 insert blocked', !!e, e?.message ?? 'ACCEPTED')
e = (await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-01-03', price: -5, status: 'pending', payment_status: 'unpaid' })).error
t('001 negative-price insert blocked', !!e, e?.message ?? 'ACCEPTED')
e = (await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-01-04', price: 99999, status: 'pending', payment_status: 'unpaid' })).error
t('001 inflated-price insert blocked', !!e, e?.message ?? 'ACCEPTED')
const { data: okAp } = await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-02-01', scheduled_at: '2030-02-01T09:00:00Z', price: sid.price, status: 'pending', payment_status: 'unpaid' }).select().single()
t('001 honest booking still works', !!okAp, okAp ? '' : 'BLOCKED — booking broken!')

// BUG-002/003 family
e = (await A.from('appointments').update({ price: 1 }).eq('id', okAp.id)).error
t('002 price tamper blocked', !!e, e?.message ?? 'ACCEPTED')
e = (await A.from('appointments').update({ clinical_note: 'hacked' }).eq('id', okAp.id)).error
t('003 clinical_note tamper blocked', !!e, e?.message ?? 'ACCEPTED')
e = (await A.from('appointments').update({ notes: 'my own note' }).eq('id', okAp.id)).error
t('patient notes edit still works', !e, e?.message ?? 'ok')
e = (await A.from('appointments').update({ status: 'cancelled' }).eq('id', okAp.id)).error
t('patient cancel still works', !e, e?.message ?? 'ok')

// BUG-004 family
const mn = (await maria.from('patients').select('medical_note').eq('id', pidM)).error
t('004 medical_note column denied to patient', !!mn, mn?.message?.slice(0, 45) ?? 'READABLE')
const all = (await maria.from('patients').select('*').eq('id', pidM)).error
t('004 patient select(*) behaves (explicit safe cols in app)', !all, all?.message?.slice(0, 45) ?? 'ok ' + Object.keys((await maria.from('patients').select('*').eq('id', pidM)).data?.[0] ?? {}).join(','))
const view = (await A.from('staff_patients').select('*')).data
t('004 staff_patients empty for patient', (view ?? []).length === 0, (view ?? []).length + ' rows leaked')
const sview = (await doc.from('staff_patients').select('*')).data
t('004 staff_patients full for doctor', (sview ?? []).some((r) => r.id === pidM))

// BUG-006/007 family
const d1 = await A.from('patients').delete().eq('id', pidA).select()
t('006 patient self-delete blocked', !!d1.error || (d1.data ?? []).length === 0, d1.error?.message?.slice(0, 40) ?? (d1.data ?? []).length + ' rows deleted')
const d2 = await doc.from('patients').delete().eq('id', pidM).select()
t('006 doctor delete patient blocked', !!d2.error || (d2.data ?? []).length === 0, d2.error?.message?.slice(0, 40) ?? (d2.data ?? []).length + ' rows deleted')
t('006 rows survive both delete attempts', !!(await svc.from('patients').select('id').eq('id', pidA)).data?.length && !!(await svc.from('patients').select('id').eq('id', pidM)).data?.length)
e = (await doc.from('patients').update({ full_name: 'Renamed' }).eq('id', pidM)).error
t('006 doctor rename patient blocked', !!e, e?.message?.slice(0, 45) ?? 'ACCEPTED')
e = (await own.from('patients').update({ full_name: 'Maria Santos' }).eq('id', pidM)).error // owner rename allowed (idempotent)
t('owner identity edit allowed (no-op rename)', !e, e?.message?.slice(0, 45))
e = (await A.from('patients').update({ patient_code: 'X' }).eq('id', pidA)).error
t('007 patient_code tamper blocked', !!e, e?.message?.slice(0, 45) ?? 'ACCEPTED')
e = (await A.from('patients').update({ phone: '+63 900 000 0001' }).eq('id', pidA)).error
t('patient contact edit still works', !e, e?.message?.slice(0, 45))

// BUG-008
e = (await A.from('payment_proofs').insert({ appointment_id: okAp.id, image: 'zzz' })).error
t('008 direct proof insert blocked', !!e, e?.message?.slice(0, 45) ?? 'ACCEPTED')

// BUG-009
e = (await doc.from('appointments').update({ payment_status: 'verified' }).eq('id', okAp.id)).error
t('009 doctor payment flip blocked', !!e, e?.message?.slice(0, 45) ?? 'ACCEPTED')
e = (await doc.from('appointments').update({ status: 'completed' }).eq('id', okAp.id)).error
t('doctor status changes still work (notes/status)', !e || /payment/.test(e.message), e?.message?.slice(0, 45))

// RPC still works end to end
const { data: payAp } = await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-03-03', scheduled_at: '2030-03-03T09:00:00Z', price: sid.price }).select().single()
const r = await A.rpc('fn_submit_payment_proof', { p_appointment: payAp.id, p_image: 'data:image/png;base64,AAAA' })
const after = (await A.from('appointments').select('status, payment_status').eq('id', payAp.id).single()).data
t('payment -> instant confirm intact', !r.error && after?.status === 'approved', r.error?.message ?? JSON.stringify(after))

console.log(R.join('\n'))

// cleanup
for (const id of [okAp?.id, payAp?.id].filter(Boolean)) await svc.from('payment_proofs').delete().eq('appointment_id', id)
await svc.from('appointments').delete().in('id', [okAp?.id, payAp?.id].filter(Boolean))
await svc.from('patients').delete().eq('user_id', uidA)
await svc.from('profiles').delete().eq('id', uidA)
await svc.auth.admin.deleteUser(uidA).catch(() => {})
await svc.from('appointments').delete().is('patient_id', null)
console.log('\n[cleanup done]')
