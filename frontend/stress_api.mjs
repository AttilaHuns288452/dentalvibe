import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const ANON = fs.readFileSync(new globalThis.URL('./.env.local', import.meta.url), 'utf8').match(/ANON_KEY=(.*)/)[1].trim()
const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const svc = createClient(URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const R = []
const t = (name, bad, detail = '') => R.push(`${bad ? 'BREAK' : 'ok   '} | ${name}${detail ? ' :: ' + detail : ''}`)

const mk = async (email, name) => {
  // signup trigger creates the patients row — do NOT insert a second one
  const { data: u } = await svc.auth.admin.createUser({ email, password: 'Stress123', email_confirm: true, user_metadata: { full_name: name } }).catch(() => ({ data: null }))
  if (u?.user?.id) return u.user.id
  const { data: users } = await svc.auth.admin.listUsers()
  return users.users.find((x) => x.email === email)?.id ?? null
}
const uidA = await mk('stress.a@test.ph', 'Stress A')
const uidB = await mk('stress.b@test.ph', 'Stress B')
const as = async (email) => { const c = createClient(URL, ANON); await c.auth.signInWithPassword({ email, password: 'Stress123' }); return c }
const A = await as('stress.a@test.ph')
const B = await as('stress.b@test.ph')
const maria = createClient(URL, ANON); await maria.auth.signInWithPassword({ email: 'maria@dentalvibe.ph', password: 'password123' })
const doc = createClient(URL, ANON); await doc.auth.signInWithPassword({ email: 'doctor@dentalvibe.ph', password: 'password123' })
const own = createClient(URL, ANON); await own.auth.signInWithPassword({ email: 'owner@dentalvibe.ph', password: 'password123' })
const pidA = (await A.from('patients').select('id').eq('user_id', uidA).limit(1)).data?.[0]?.id
const pidB = (await B.from('patients').select('id').eq('user_id', uidB).limit(1)).data?.[0]?.id
const pidM = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id
const sid = (await svc.from('services').select('id, price').limit(1).single()).data

// ===== 1. APPOINTMENT INSERT ABUSE =====
let e = (await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-01-01', price: 0, status: 'approved', payment_status: 'paid', scheduled_at: '2030-01-01T09:00:00Z' })).error
t('patient INSERT self-confirmed appointment (approved+paid+price 0)', !e, e?.message ?? 'ACCEPTED')
let e2 = (await A.from('appointments').insert({ patient_id: pidB, service_id: sid.id, requested_date: '2030-01-02', price: 500 })).error
t('patient INSERT appointment FOR patient B', !e2, e2?.message ?? 'ACCEPTED')
let e3 = (await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-01-03', price: -9999 })).error
t('patient INSERT negative price', !e3, e3?.message ?? 'ACCEPTED')
let e4 = (await A.from('appointments').insert({ patient_id: pidA, service_id: '00000000-0000-0000-0000-000000000000', requested_date: '2030-01-04', price: 500 })).error
t('patient INSERT invalid service FK', !e4, e4?.message ?? 'ACCEPTED')
let e5 = (await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-01-05', price: 500, status: 'completed', payment_status: 'paid' })).error
t('patient INSERT completed+paid (free income)', !e5, e5?.message ?? 'ACCEPTED')

// ===== 2. APPOINTMENT UPDATE ABUSE =====
const { data: myAppt, error: myApptErr } = await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-02-01', scheduled_at: '2030-02-01T09:00:00Z', price: 500 }).select().single()
if (!myAppt) { console.log('SETUP FAIL myAppt:', myApptErr?.message, '| pidA:', pidA, '| pidB:', pidB, '| uidA:', uidA); process.exit(1) }
let u1 = (await A.from('appointments').update({ price: 1 }).eq('id', myAppt.id)).error
const afterPrice = (await svc.from('appointments').select('price').eq('id', myAppt.id).single()).data?.price
t('patient UPDATE own price 500 -> 1', !u1 && String(afterPrice) !== '500.00', u1?.message ?? 'price now ' + afterPrice)
let u2 = (await A.from('appointments').update({ status: 'completed' }).eq('id', myAppt.id)).error
t('patient UPDATE status -> completed (clinic-only state)', !u2, u2?.message ?? 'ACCEPTED')
let u3 = (await A.from('appointments').update({ clinical_note: 'hacked' }).eq('id', myAppt.id)).error
const cn = (await svc.from('appointments').select('clinical_note').eq('id', myAppt.id).single()).data?.clinical_note
t('patient UPDATE clinical_note (internal field)', cn === 'hacked', (u3?.message ?? 'ok') + ' note=' + cn)
let u4 = (await A.from('appointments').update({ status: 'cancelled' }).eq('id', myAppt.id)).error
t('patient CANCEL own booking (allowed by design)', !!u4, u4?.message ?? 'cancelled ok')
// doctor completes unpaid appointment (bypassing payment?)
const { data: ap2 } = await A.from('appointments').insert({ patient_id: pidA, service_id: sid.id, requested_date: '2030-03-01', scheduled_at: '2030-03-01T09:00:00Z', price: 500 }).select().single()
const u5 = (await doc.from('appointments').update({ status: 'completed', payment_status: 'paid' }).eq('id', ap2.id)).error
t('doctor force-completes unpaid appointment (income bypass)', !u5, u5?.message ?? 'ACCEPTED')

// ===== 3. CROSS-USER + TABLES =====
t('patient A READS patient B', (await A.from('patients').select('*').eq('id', pidB)).data?.length > 0)
t('patient READS ehr_attachments (spec: hidden from patients)', (await A.from('ehr_attachments').select('*')).data?.length > 0)
const mn = (await A.from('patients').select('medical_note').eq('id', pidA).single()).data
t('patient READS medical_note field exists on own row (internal)', mn !== null && mn.medical_note !== undefined, JSON.stringify(mn))
t('patient UPDATES own patient_code', !(await A.from('patients').update({ patient_code: 'X-1' }).eq('id', pidA)).error)
t('patient INSERT transaction', !(await A.from('transactions').insert({ kind: 'income', label: 'hack', amount: 99999 })).error)
t('patient INSERT service', !(await A.from('services').insert({ name: 'Free', price: 1 })).error)
t('patient UPDATE clinic_settings', !(await A.from('clinic_settings').update({ clinic_name: 'Hacked' })).error)
t('patient INSERT notification for B', !(await A.from('notifications').insert({ user_id: uidB, title: 'spam', body: 'x' })).error)
t('patient INSERT dentists', !(await A.from('dentists').insert({ full_name: 'Fake', email: 'fake@x.ph', role: 'doctor' })).error)
t('patient INSERT payment_proofs directly (bypass RPC)', !(await A.from('payment_proofs').insert({ appointment_id: ap2.id, image: 'zzz' })).error)
t('patient DELETES own patient row (orphan maker)', !(await A.from('patients').delete().eq('id', pidA)).error)
t('patient self-promotes to owner', (async () => { await A.from('profiles').update({ role: 'owner' }).eq('id', uidA); return (await A.from('profiles').select('role').eq('id', uidA).single()).data?.role === 'owner' })())

// ===== 4. DOCTOR SCOPE =====
t('doctor DELETES patient B row', !(await doc.from('patients').delete().eq('id', pidB)).error)
t('doctor RENAMES patient B', !(await doc.from('patients').update({ full_name: 'Renamed' }).eq('id', pidB)).error)
t('doctor INSERT service (owner-only?)', !(await doc.from('services').insert({ name: 'DocSvc', price: 100 })).error)
t('doctor INSERT transaction (ledger)', !(await doc.from('transactions').insert({ kind: 'expense', label: 'x', amount: 5000 })).error)
t('doctor INSERT ehr_attachment for Maria', !(await doc.from('ehr_attachments').insert({ patient_id: pidM, kind: 'x-ray', file_name: 'x.png' })).error)

// ===== 5. DOUBLE-SUBMIT / RACE =====
const [r1, r2] = await Promise.all([
  maria.from('appointments').insert({ patient_id: pidM, service_id: sid.id, requested_date: '2031-01-01', price: 500 }),
  maria.from('appointments').insert({ patient_id: pidM, service_id: sid.id, requested_date: '2031-01-01', price: 500 }),
])
t('parallel double-booking same patient+date (race)', !(r1.error && r2.error), `r1=${r1.error?.message ?? 'ok'} r2=${r2.error?.message ?? 'ok'}`)

// ===== 6. PAYMENT ABUSE (PayMongo surface: paymongo-create / paymongo-check) =====
const { data: payAp } = await maria.from('appointments').insert({ patient_id: pidM, service_id: sid.id, requested_date: '2031-02-02', scheduled_at: '2031-02-02T09:00:00Z', price: 500 }).select().single()
const fx = (c, name, body) => c.functions.invoke(name, { body })
const p3 = await fx(maria, 'paymongo-create', { appointment_id: payAp.id })
t('create payment OK (mock provider)', !p3.error && !!p3.data?.payment_id, p3.error?.message ?? JSON.stringify(p3.data)?.slice(0, 60))
const p4 = await fx(maria, 'paymongo-create', { appointment_id: payAp.id })
t('create is idempotent (no second intent)', !p4.error && p4.data?.payment_id === p3.data?.payment_id, p4.error?.message ?? `ids ${p3.data?.payment_id} vs ${p4.data?.payment_id}`)
const p5 = await fx(A, 'paymongo-create', { appointment_id: payAp.id })
t('create on SOMEONE ELSE appointment rejected', !!p5.error || !!p5.data?.error, p5.error?.message ?? p5.data?.error ?? 'ACCEPTED')
const p6 = await fx(A, 'paymongo-check', { payment_id: p3.data?.payment_id, simulate: 'paid' })
t('check on SOMEONE ELSE payment rejected', !!p6.error || p6.data?.error, p6.error?.message ?? p6.data?.error ?? 'ACCEPTED')
const p7 = await fx(maria, 'paymongo-check', { payment_id: p3.data?.payment_id, simulate: 'paid' })
t('legit settle works once', !p7.error && p7.data?.status === 'paid', p7.error?.message ?? JSON.stringify(p7.data))
const p8 = await fx(maria, 'paymongo-check', { payment_id: p3.data?.payment_id, simulate: 'paid' })
t('replay settle stays single', !p8.error && p8.data?.status === 'paid', p8.error?.message ?? JSON.stringify(p8.data))
const { data: txAfter } = await svc.from('transactions').select('id').eq('payment_id', p3.data?.payment_id)
t('exactly one ledger row per payment', txAfter?.length === 1, `count=${txAfter?.length}`)

console.log(R.join('\n'))

// ===== CLEANUP =====
await svc.from('transactions').delete().eq('payment_id', p3.data?.payment_id)
await svc.from('appointments').delete().in('patient_id', [pidA, pidB, pidM].filter(Boolean))
await svc.from('appointments').delete().is('patient_id', null)
await svc.from('ehr_attachments').delete().eq('patient_id', pidM)
await svc.from('transactions').delete().eq('label', 'x')
await svc.from('transactions').delete().eq('label', 'hack')
await svc.from('services').delete().in('name', ['Free', 'DocSvc'])
await svc.from('patients').delete().in('user_id', [uidA, uidB].filter(Boolean))
await svc.from('patients').update({ patient_code: 'DAR-0001' }).eq('id', pidM)
for (const uid of [uidA, uidB].filter(Boolean)) { await svc.from('profiles').delete().eq('id', uid); await svc.auth.admin.deleteUser(uid).catch(() => {}) }
await svc.from('clinic_settings').update({ clinic_name: 'D.A.R. Dental Clinic' }).eq('id', 1)
console.log('\n[cleanup done]')
