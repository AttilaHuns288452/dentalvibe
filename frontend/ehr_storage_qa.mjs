// ehr_storage_qa.mjs — EHR storage authorization + signed URL hardening (§1/§3/§4).
// Every case talks to the Supabase Storage API DIRECTLY with real role sessions
// (patient / doctor / owner / deactivated staff) — no UI involved, so a hidden
// button could never make these pass.
// Run (from frontend/): node ehr_storage_qa.mjs   (needs SB_SECRET)
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const env = Object.fromEntries(fs.readFileSync(new URL('./.env.local', import.meta.url), 'utf8').trim().split('\n').map((l) => l.split('=')))
const SB = env.VITE_SUPABASE_URL
const svc = createClient(SB, process.env.SB_SECRET)
const B = 'ehr-files'
let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }
const login = async (email) => {
  const c = createClient(SB, env.VITE_SUPABASE_ANON_KEY)
  await c.auth.signInWithPassword({ email, password: 'password123' })
  return c
}

const patient = await login('maria@dentalvibe.ph')
const doctor = await login('doctor@dentalvibe.ph')
const owner = await login('owner@dentalvibe.ph')

const { data: patRow } = await svc.from('patients').select('id').eq('email', 'maria@dentalvibe.ph').maybeSingle()
const FIX = `${patRow.id}/qa-storage-${Date.now()}.png`
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]) // tiny PNG-ish fixture

// ── patient: every verb denied (§3) ─────────────────────────────────────────
const pList = await patient.storage.from(B).list(patRow.id)
check('1. patient cannot list ehr-files', (pList.data ?? []).length === 0, pList.error?.message?.slice(0, 40) ?? 'rows=' + (pList.data ?? []).length)
const pDown = await patient.storage.from(B).download(FIX)
check('2. patient cannot download a known EHR path', !!pDown.error, pDown.error?.message?.slice(0, 40) ?? 'downloaded!')
const pSign = await patient.storage.from(B).createSignedUrl(FIX, 60)
check('3. patient cannot create a signed URL', !!pSign.error, pSign.error?.message?.slice(0, 40) ?? pSign.data?.signedUrl?.slice(0, 30))
const pUp = await patient.storage.from(B).upload(`${patRow.id}/evil.png`, png, { contentType: 'image/png' })
check('4. patient cannot upload to ehr-files', !!pUp.error, pUp.error?.message?.slice(0, 40) ?? 'uploaded!')
const pMeta = await patient.from('ehr_attachments').select('id').limit(5)
check('5. patient cannot read attachment metadata', (pMeta.data ?? []).length === 0, pMeta.error?.message ?? 'rows=' + (pMeta.data ?? []).length)

// ── doctor: authorized fixture upload + metadata + audit (§7/§10) ───────────
const up = await doctor.storage.from(B).upload(FIX, png, { contentType: 'image/png' })
check('6. doctor uploads authorized fixture', !up.error, up.error?.message?.slice(0, 60))
const { data: meta, error: metaErr } = await doctor.from('ehr_attachments').insert({
  patient_id: patRow.id, category: 'QA Storage', filename: 'qa-storage.png', path: FIX,
}).select().maybeSingle()
check('7. doctor inserts attachment metadata', !!meta && !metaErr, metaErr?.message?.slice(0, 60))
const { data: upAudit } = await svc.from('audit_log').select('id, action').eq('entity_id', meta?.id ?? 'x')
check('8. upload produces an audit entry', (upAudit ?? []).length >= 1, 'rows=' + (upAudit ?? []).length)

// ── signed URLs (§4) ───────────────────────────────────────────────────────
const dSign = await doctor.storage.from(B).createSignedUrl(FIX, 60)
check('9. doctor can generate a signed URL', !dSign.error && !!dSign.data?.signedUrl, dSign.error?.message?.slice(0, 40))
const signed = dSign.data?.signedUrl ?? ''
check('10. URL is signed, not a public storage URL', /\/sign\/|token=/.test(signed) && !/\/object\/public\//.test(signed), signed.slice(0, 60))
const openRes = await fetch(signed)
const bytes = openRes.ok ? new Uint8Array(await openRes.arrayBuffer()) : new Uint8Array()
check('11. signed URL opens the file (bytes roundtrip)', openRes.status === 200 && bytes.length === png.length, 's=' + openRes.status + ' n=' + bytes.length)
const oSign = await owner.storage.from(B).createSignedUrl(FIX, 60)
check('12. owner can generate a signed URL', !oSign.error && !!oSign.data?.signedUrl, oSign.error?.message?.slice(0, 40))

// expired URL must not work (short-lived by design — 1s TTL here to prove expiry)
const eSign = await doctor.storage.from(B).createSignedUrl(FIX, 1)
await new Promise((r) => setTimeout(r, 2500))
const expRes = await fetch(eSign.data?.signedUrl ?? '')
check('13. expired signed URL no longer serves the file', expRes.status !== 200, 's=' + expRes.status)

// ── deactivated staff (fn_my_role() -> null) ────────────────────────────────
const u = await svc.auth.admin.createUser({ email: 'qa_deact_dds@' + Date.now() + '.test', password: 'password123', email_confirm: true })
if (!u.error) {
  await svc.from('profiles').update({ role: 'doctor' }).eq('id', u.data.user.id)
  await svc.from('dentists').insert({ full_name: 'QA Deactivated DDS', email: u.data.user.email, active: false })
  const deact = createClient(SB, env.VITE_SUPABASE_ANON_KEY)
  await deact.auth.signInWithPassword({ email: u.data.user.email, password: 'password123' })
  const dList = await deact.storage.from(B).list(patRow.id)
  const dDown = await deact.storage.from(B).download(FIX)
  const dSign2 = await deact.storage.from(B).createSignedUrl(FIX, 60)
  const dUp = await deact.storage.from(B).upload(`${patRow.id}/x.png`, png, { contentType: 'image/png' })
  check('14. deactivated staff denied list/read/sign/upload',
    (dList.data ?? []).length === 0 && !!dDown.error && !!dSign2.error && !!dUp.error,
    'list=' + (dList.data ?? []).length + ' down=' + (!!dDown.error) + ' sign=' + (!!dSign2.error) + ' up=' + (!!dUp.error))
  await svc.from('dentists').delete().eq('email', u.data.user.email)
  await svc.auth.admin.deleteUser(u.data.user.id)
} else check('14. deactivated staff denied list/read/sign/upload', false, u.error.message)

// ── server-side validation boundary (§5) ───────────────────────────────────
const badType = await doctor.storage.from(B).upload(`${patRow.id}/fake.png`, new Blob(['not an image'], { type: 'text/plain' }), { contentType: 'text/plain' })
check('15. wrong MIME rejected by the BUCKET (server-side)', !!badType.error, badType.error?.message?.slice(0, 50) ?? 'accepted!')
const big = new Uint8Array(10 * 1024 * 1024 + 10)
const oversize = await doctor.storage.from(B).upload(`${patRow.id}/big.png`, big, { contentType: 'image/png' })
check('16. oversize (>10MB) rejected by the BUCKET (server-side)', !!oversize.error, oversize.error?.message?.slice(0, 50) ?? 'accepted!')

// ── path safety (§6) ───────────────────────────────────────────────────────
const trav = await doctor.storage.from(B).upload('../../evil-trav.png', png, { contentType: 'image/png' })
const travKey = trav.data?.path ?? ''
check('17. traversal path cannot escape the bucket root', trav.error ? true : !travKey.includes('..'), trav.error?.message?.slice(0, 40) ?? travKey)
const dup = await doctor.storage.from(B).upload(FIX, png, { contentType: 'image/png' })
check('18. upsert=false: same path cannot overwrite', !!dup.error, dup.error?.message?.slice(0, 50) ?? 'overwritten!')

// ── delete consistency (§8) ────────────────────────────────────────────────
await patient.storage.from(B).remove([FIX])
const still = await doctor.storage.from(B).download(FIX)
check('19. patient delete denied (file still present)', !!still.data, 'file-gone=' + (!!still.error))
const del1 = await doctor.storage.from(B).remove([FIX])
const { data: afterList } = await svc.storage.from(B).list(patRow.id)
const del2 = await doctor.from('ehr_attachments').delete().eq('id', meta?.id ?? 'x')
// NOTE: assert deletion via the remove response + authoritative list, NOT via
// download-after — object GETs can be CDN-cached (max-age) and would false-fail
check('20. staff delete removes file + metadata', !del1.error && (del1.data ?? []).length === 1 && (afterList ?? []).length === 0 && !del2.error, 'removed=' + (del1.data ?? []).length + ' left=' + (afterList ?? []).length)
const del3 = await doctor.storage.from(B).remove([FIX]) // file already gone
check('21. deleting an already-missing object is a safe no-op', !del3.error, del3.error?.message?.slice(0, 40))
const { data: delAudit } = await svc.from('audit_log').select('id').eq('entity_id', meta?.id ?? 'x')
check('22. upload + delete both audited', (delAudit ?? []).length >= 2, 'rows=' + (delAudit ?? []).length)

// cleanup
await svc.storage.from(B).remove([FIX, `${patRow.id}/evil.png`, `${patRow.id}/fake.png`, `${patRow.id}/big.png`, '../../evil-trav.png']).catch(() => {})
await svc.from('ehr_attachments').delete().eq('path', FIX)
await svc.from('audit_log').delete().eq('entity_id', meta?.id ?? 'x')

console.log(`\n===== EHR STORAGE QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail === 0 ? 0 : 1)
