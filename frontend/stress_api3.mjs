import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const ANON = fs.readFileSync(new globalThis.URL('./.env.local', import.meta.url), 'utf8').match(/ANON_KEY=(.*)/)[1].trim()
const URL = 'https://wfmtkmfevdqbhtpqamic.supabase.co'
const svc = createClient(URL, process.env.SB_SECRET, { auth: { persistSession: false } })
const as = async (email, pw) => { const c = createClient(URL, ANON); await c.auth.signInWithPassword({ email, password: pw }); return c }
const doc = await as('doctor@dentalvibe.ph', 'password123')
const own = await as('owner@dentalvibe.ph', 'password123')
const maria = await as('maria@dentalvibe.ph', 'password123')
const pidM = (await svc.from('patients').select('id').eq('full_name', 'Maria Santos').limit(1)).data[0].id

// EHR staff insert (p110) — real columns
const r1 = await doc.from('ehr_attachments').insert({ patient_id: pidM, category: 'X-ray', filename: 'probe.png' })
console.log('doctor INSERT ehr_attachment:', r1.error ? 'BLOCKED: ' + r1.error.message : 'ok — accepted (p110 works)')
const r2 = await maria.from('ehr_attachments').insert({ patient_id: pidM, category: 'X-ray', filename: 'evil.png' })
console.log('patient INSERT ehr_attachment:', r2.error ? 'ok — blocked' : 'BREAK — accepted')
const r3 = await maria.from('ehr_attachments').delete().eq('filename', 'probe.png')
console.log('patient DELETE ehr_attachment:', r3.error ? 'ok — blocked' : (r3.data?.length ?? 0) + ' rows deleted — ' + ((r3.data?.length ?? 0) > 0 ? 'BREAK' : 'ok (0 rows means RLS hid it)'))
await svc.from('ehr_attachments').delete().in('filename', ['probe.png', 'evil.png'])

// INCOME RECOMPUTE — independent sum vs what IncomeHub shows
const { data: appts } = await svc.from('appointments').select('price, status, payment_status, scheduled_at, requested_date')
const paidIncome = appts.filter(a => a.payment_status === 'paid' && a.status !== 'cancelled').reduce((s, a) => s + Number(a.price), 0)
const completedIncome = appts.filter(a => a.status === 'completed').reduce((s, a) => s + Number(a.price), 0)
const { data: tx } = await svc.from('transactions').select('*')
const manualIncome = tx.filter(t => t.kind === 'income').reduce((s, t) => s + Number(t.amount), 0)
const expenses = tx.filter(t => t.kind === 'expense').reduce((s, t) => s + Number(t.amount), 0)
console.log('\nINCOME RECOMPUTE (source rows):')
console.log('  paid appts sum:', paidIncome, '| completed appts sum:', completedIncome)
console.log('  manual income:', manualIncome, '| expenses:', expenses, '| expected net (IncomeHub formula):', paidIncome + manualIncome - expenses)
console.log('  tx count:', tx.length, '| appt count:', appts.length)
console.log('  refunds/failed-payment concept:', 'NONE (design: no refund states exist)')

// search/filter data-level checks
const s1 = await svc.from('patients').select('full_name').ilike('full_name', '%maria%')
console.log('\nSEARCH: ilike %maria% ->', s1.data?.map(r => r.full_name))
const s2 = await svc.from('patients').select('full_name').ilike('full_name', '%MARIA%')
console.log('SEARCH: ilike %MARIA% (case) ->', s2.data?.length, 'rows')
const s3 = await svc.from('patients').select('full_name').ilike('full_name', '%zzz%')
console.log('SEARCH: no-result ->', s3.data?.length, 'rows')
const s4 = await svc.from('appointments').select('id').eq('patient_id', pidM).limit(1000)
console.log('LIST: appointments limit behavior ->', s4.data?.length, 'rows for Maria (no pagination in UI)')
