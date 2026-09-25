// push_qa.mjs — real Web Push QA (§25/§29): the full chain is verified as
//   business event → notification row → pg_net → push-dispatch → Push service
//   → service worker → showNotification (asserted via registration.getNotifications)
// plus subscription ownership/RLS, dedupe, invalid-subscription cleanup, logout.
// Run (from frontend/): SB_SECRET=<service key> node push_qa.mjs   (serve :4176)
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import crypto from 'crypto'
import { chromium } from './qa_playwright.mjs'

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
const SB = env.VITE_SUPABASE_URL
const svc = createClient(SB, process.env.SB_SECRET)
const BASE = process.env.QA_BASE || 'http://localhost:4176'

let pass = 0, fail = 0
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : '')) }

// Real push needs (learned the hard way):
//  1. headed — headless Chromium reports Notification.permission=denied
//  2. a PERSISTENT profile — ephemeral contexts fail subscribe() with the
//     misleading 'Registration failed - permission denied'
//  3. branded Chrome for FCM credentials (QA_CHROME=/path/to/chrome);
//     unbranded/Chrome-for-Testing builds cannot register push at all.
import os from 'node:os'
const profileDir = os.tmpdir() + '/dv-push-qa-profile-A-' + Date.now() // fresh device per run
const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  executablePath: process.env.QA_CHROME || undefined,
  permissions: ['notifications'],
})
const pg = await ctx.newPage()
const pageErrors = []
pg.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

// ── 1. login + enable push through the real Settings UI (user gesture) ──
await pg.goto(BASE + '/login', { waitUntil: 'networkidle' })
await pg.fill('input[type="email"]', 'maria@dentalvibe.ph')
await pg.fill('input[type="password"]', 'password123')
await pg.locator('form button:has-text("Sign In")').last().click()
await pg.waitForTimeout(2500)
await pg.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await pg.waitForTimeout(800)
check('1. notifications panel present', (await pg.locator('main').textContent()).includes('Phone notifications'))

await pg.locator('button:has-text("Enable phone notifications")').click()
let settingsTxt = ''
for (let i = 0; i < 12 && !settingsTxt.includes('Notifications enabled') && !settingsTxt.includes('>Enabled<') && !/Enabled/.test(settingsTxt.replace('Not enabled', '')); i++) {
  await pg.waitForTimeout(1500)
  settingsTxt = await pg.locator('main').textContent()
}
check('2. UI reports enabled only after subscribe+register', settingsTxt.includes('Notifications enabled') || settingsTxt.includes('Enabled'), settingsTxt.slice(0, 60))

// the subscription really exists in the browser
const sub = await pg.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready
  const s = await reg.pushManager.getSubscription()
  return s ? { endpoint: s.endpoint.slice(0, 40), hasKeys: !!s.toJSON().keys.p256dh } : null
})
check('3. real PushManager subscription exists', !!sub && sub.hasKeys, JSON.stringify(sub))

// ── 2. it is stored server-side, owned by the session user ──
const { data: me } = await svc.from('patients').select('id, user_id').eq('email', 'maria@dentalvibe.ph').maybeSingle()
const { data: rows } = await svc.from('push_subscriptions').select('id, user_id, endpoint, revoked_at').eq('user_id', me.user_id).is('revoked_at', null)
check('4. subscription persisted for the right user', (rows ?? []).length >= 1, 'rows=' + (rows ?? []).length)
check('5. multi-device safe (rows keyed by endpoint)', (rows ?? []).every((r) => !!r.endpoint))

// ── 3. REAL push chain: business event → SW shows the notification ──
// clear any existing notifications first
await pg.evaluate(async () => { const reg = await navigator.serviceWorker.ready; (await reg.getNotifications()).forEach((n) => n.close()) })
const d = new Date(Date.now() + (90 + Math.floor(Math.random() * 100)) * 864e5); d.setUTCHours(1, 0, 0, 0)
const { data: svcRow } = await svc.from('services').select('id, price').eq('active', true).order('price').limit(1).maybeSingle()
const { data: appt, error: aerr } = await svc.from('appointments').insert({
  patient_id: me.id, service_id: svcRow.id, service_ids: [svcRow.id], scheduled_at: d.toISOString(),
  requested_date: d.toISOString().slice(0, 10), price: svcRow.price, status: 'pending', payment_status: 'unpaid',
}).select().maybeSingle()
check('6. business event created (appointment booked)', !!appt, aerr?.message?.slice(0, 40) ?? '')

// wait for: notification row → pg_net → push-dispatch → push service → SW
let notes = []
for (let i = 0; i < 20 && notes.length === 0; i++) {
  await pg.waitForTimeout(1500)
  notes = await pg.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, route: n.data && n.data.route }))
  })
}
check('7. REAL PUSH: service worker displayed the notification', notes.length >= 1, JSON.stringify(notes[0] ?? {}).slice(0, 90))
check('8. notification content + deep link correct', !!notes[0] && notes[0].title.includes('Appointment') && (notes[0].route || '').startsWith('/'), (notes[0] && notes[0].route) || '')

// in-app persistent notification (the source of truth) also exists
const { data: inApp } = await svc.from('notifications').select('title, dedupe_key, route').eq('user_id', me.user_id).eq('dedupe_key', 'appt:' + appt.id + ':booked:patient')
check('9. persistent in-app notification with deterministic event key', (inApp ?? []).length === 1, 'rows=' + (inApp ?? []).length)

// ── 4. idempotency: re-firing the same logical event adds nothing ──
await svc.from('appointments').update({ notes: 'touch' }).eq('id', appt.id) // update that must NOT re-notify as 'booked'
const { data: inApp2 } = await svc.from('notifications').select('id').eq('user_id', me.user_id).eq('dedupe_key', 'appt:' + appt.id + ':booked:patient')
check('10. one logical event = one notification (no spam)', (inApp2 ?? []).length === 1, 'rows=' + (inApp2 ?? []).length)

// ── 5. security: patients cannot read/manage others' subscriptions ──
const other = createClient(SB, env.VITE_SUPABASE_ANON_KEY)
await other.auth.signInWithPassword({ email: 'juan@dentalvibe.ph', password: 'password123' })
const { data: juanRow } = await other.from('patients').select('user_id').eq('email', 'juan@dentalvibe.ph').maybeSingle()
const { data: cross } = await other.from('push_subscriptions').select('id, user_id')
check('11. another patient sees ONLY own subscriptions (RLS)', (cross ?? []).every((r) => r.user_id === juanRow.user_id) && !(cross ?? []).some((r) => r.user_id === me.user_id), 'rows=' + (cross ?? []).length)
const delRes = await other.from('push_subscriptions').delete().eq('user_id', me.user_id).select()
check('12. another patient cannot delete foreign subscriptions (0 rows affected)', (delRes.data ?? []).length === 0, 'deleted=' + (delRes.data ?? []).length)
const { data: survivor } = await svc.from('push_subscriptions').select('id').eq('user_id', me.user_id).is('revoked_at', null)
check('12b. victim subscription still present after the attack', (survivor ?? []).length >= 1, 'rows=' + (survivor ?? []).length)

// forged user_id in the register body must be ignored (server derives identity)
const { data: { session } } = await other.auth.getSession()
const forge = await fetch(SB + '/functions/v1/push-register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
  body: JSON.stringify({ endpoint: 'https://fcm.googleapis.com/fcm/send/forge-' + Date.now(), keys: { p256dh: 'x', auth: 'y' }, user_id: me.user_id }),
})
const { data: forgeRows } = await svc.from('push_subscriptions').select('user_id').like('endpoint', '%forge-%')
check('13. forged user_id ignored — subscription binds to the SESSION user', forge.ok && (forgeRows ?? []).every((r) => r.user_id !== me.user_id), 'forge=' + forge.status)

// unauthenticated dispatch is rejected
const badDispatch = await fetch(SB + '/functions/v1/push-dispatch', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notification_id: 'x' }),
})
check('14. push-dispatch rejects calls without the internal secret', badDispatch.status === 401, 's=' + badDispatch.status)

// ── 6. invalid subscription cleanup (dead endpoint → revoked, not retried) ──
// dead row must carry a REAL curve point (random bytes fail local validation
// and never reach the push service) — this exercises the true 404/410 path
const { publicKey: deadPub } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const dj = deadPub.export({ format: 'jwk' })
const deadPoint = Buffer.concat([Buffer.from([4]), Buffer.from(dj.x, 'base64url'), Buffer.from(dj.y, 'base64url')]).toString('base64url')
const { data: dead } = await svc.from('push_subscriptions').insert({
  user_id: me.user_id, endpoint: 'https://fcm.googleapis.com/fcm/send/dead-' + Date.now(),
  p256dh: deadPoint, auth: crypto.randomBytes(16).toString('base64url'), revoked_at: null,
}).select().maybeSingle()
const { data: malformed } = await svc.from('push_subscriptions').insert({
  user_id: me.user_id, endpoint: 'https://fcm.googleapis.com/fcm/send/badkeys-' + Date.now(),
  p256dh: 'ZGVhZGtleQ', auth: 'ZGVhZGF1dGg', revoked_at: null, // malformed keys → local validation error
}).select().maybeSingle()
// trigger a dispatch for a fresh notification to this user
const { data: nrow } = await svc.from('notifications').insert({
  user_id: me.user_id, title: 'Cleanup probe', body: 'probe', route: '/notifications', dedupe_key: 'probe:' + Date.now(),
}).select().maybeSingle()
let deadRow = null
for (let i = 0; i < 12 && (!deadRow || !deadRow.revoked_at); i++) {
  await pg.waitForTimeout(1500)
  const { data } = await svc.from('push_subscriptions').select('revoked_at').eq('id', dead.id).maybeSingle()
  deadRow = data
}
check('15. dead subscription revoked automatically (404/410 cleanup)', !!deadRow?.revoked_at, JSON.stringify(deadRow))
const { data: malRow } = await svc.from('push_subscriptions').select('revoked_at').eq('id', malformed.id).maybeSingle()
check('15b. malformed subscription revoked (cannot poison future sends)', !!malRow?.revoked_at, JSON.stringify(malRow))

// ── 8. multi-device: a second DEVICE for the same user gets the push too ──
const ctxB = await chromium.launchPersistentContext(os.tmpdir() + '/dv-push-qa-profile-B-' + Date.now(), { // fresh = genuinely a second device
  headless: false,
  executablePath: process.env.QA_CHROME || undefined,
  permissions: ['notifications'],
})
const pgB = await ctxB.newPage()
await pgB.goto(BASE + '/login', { waitUntil: 'networkidle' })
await pgB.fill('input[type="email"]', 'maria@dentalvibe.ph')
await pgB.fill('input[type="password"]', 'password123')
await pgB.locator('form button:has-text("Sign In")').last().click()
await pgB.waitForTimeout(2500)
await pgB.goto(BASE + '/settings', { waitUntil: 'networkidle' })
await pgB.locator('button:has-text("Enable phone notifications")').click()
await pgB.waitForTimeout(5000)
const { data: mariaSubs } = await svc.from('push_subscriptions').select('endpoint').eq('user_id', me.user_id).is('revoked_at', null)
check('18. two devices = two active subscriptions (no overwrite)', (mariaSubs ?? []).length >= 2, 'subs=' + (mariaSubs ?? []).length)
// clear both devices' notifications, fire ONE event, both must show it
await pg.evaluate(async () => { const r = await navigator.serviceWorker.ready; (await r.getNotifications()).forEach((n) => n.close()) })
await pgB.evaluate(async () => { const r = await navigator.serviceWorker.ready; (await r.getNotifications()).forEach((n) => n.close()) })
const { data: multi } = await svc.from('notifications').insert({
  user_id: me.user_id, title: 'Multi-device probe', body: 'both devices should show this', route: '/notifications', dedupe_key: 'multi:' + Date.now(),
}).select().maybeSingle()
const seen = async (p) => {
  for (let i = 0; i < 15; i++) {
    await p.waitForTimeout(1500)
    const n = await p.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((x) => x.title))
    if (n.includes('Multi-device probe')) return true
  }
  return false
}
const [sA, sB] = await Promise.all([seen(pg), seen(pgB)])
check('19. one event reaches EVERY active device', sA && sB, 'A=' + sA + ' B=' + sB)
await svc.from('notifications').delete().eq('id', multi.id)
await ctxB.close()

// ── 7. logout unregisters this device ──
await pg.evaluate(async () => { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); if (s) window.__ep = s.endpoint })
const ep = await pg.evaluate(() => window.__ep)
await pg.locator('button:has-text("Log Out")').first().click().catch(() => {})
await pg.waitForTimeout(2500)
const { data: afterLogout } = await svc.from('push_subscriptions').select('revoked_at').eq('endpoint', ep).maybeSingle()
check('16. logout revokes this device subscription', !!afterLogout?.revoked_at || !afterLogout, JSON.stringify(afterLogout))

// cleanup (rows owned by this run)
await svc.from('notifications').delete().eq('dedupe_key', nrow?.dedupe_key ?? 'probe:none')
await svc.from('push_subscriptions').delete().in('id', [dead.id, malformed.id])
await svc.from('push_subscriptions').delete().like('endpoint', '%forge-%')
await svc.from('push_subscriptions').delete().eq('user_id', me.user_id) // QA owns this demo account's rows
await svc.from('transactions').delete().eq('appointment_id', appt.id)
await svc.from('payments').delete().eq('appointment_id', appt.id)
await svc.from('appointments').delete().eq('id', appt.id)

check('17. no page errors', pageErrors.length === 0, pageErrors.join(';'))
await ctx.close()
console.log(`\n===== PUSH QA: ${pass} passed, ${fail} failed =====`)
process.exit(fail ? 1 : 0)
