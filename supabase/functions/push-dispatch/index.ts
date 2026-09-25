// push-dispatch — INTERNAL Web Push sender. Called only by the database
// notification trigger (pg_net) with the shared internal secret. Never public:
// no browser can dispatch an arbitrary notification (§19).
//
// Architecture invariant (§20): push delivery is SECONDARY. This function is
// fire-and-forget from the DB's perspective — it never holds business state and
// can never roll back a payment/appointment/message.
//
// Delivery: npm:web-push (VAPID ES256 + aes128gcm payload encryption).
// Invalid/expired subscriptions (404/410) are revoked, not retried forever.
import webpush from 'npm:web-push@3.6.7'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const svcAuth = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }

async function rest<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...svcAuth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`rest ${path}: ${res.status} ${text}`)
  return text ? (JSON.parse(text) as T[]) : []
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req: Request) => {
  try {
    // internal shared secret — fail closed
    const secret = req.headers.get('x-push-secret') ?? ''
    const rows = await rest<{ value: string }>("service_config?key=eq.push_internal_secret&select=value")
    if (!rows.length || secret !== rows[0].value) return json({ error: 'unauthorized' }, 401)

    const cfg = await rest<{ key: string; value: string }>("service_config?key=in.(vapid_private,vapid_public)&select=key,value")
    const map = Object.fromEntries(cfg.map((r) => [r.key, r.value]))
    if (!map.vapid_private || !map.vapid_public) return json({ error: 'vapid not configured' }, 503)
    webpush.setVapidDetails('mailto:clinic@dentalvibe.ph', map.vapid_public, map.vapid_private)

    const { notification_id } = await req.json()
    if (!notification_id) return json({ error: 'notification_id required' }, 400)

    const notifRows = await rest<{ id: string; user_id: string; title: string; body: string; route: string | null }>(
      `notifications?id=eq.${notification_id}&select=id,user_id,title,body,route`,
    )
    const n = notifRows[0]
    if (!n) return json({ error: 'notification not found' }, 404)

    const subs = await rest<{ id: string; endpoint: string; p256dh: string; auth: string }>(
      `push_subscriptions?user_id=eq.${n.user_id}&revoked_at=is.null&select=id,endpoint,p256dh,auth`,
    )

    const payload = JSON.stringify({ title: n.title, body: n.body, route: n.route ?? '/notifications', icon: '/icon.svg' })
    let sent = 0, revoked = 0, failed = 0
    const codes: number[] = []
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        sent++
        await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ last_success_at: new Date().toISOString() }) })
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode ?? 0
        codes.push(code)
        const msg = String((e as Error).message ?? '')
        // local crypto/validation failures (malformed stored keys) can never
        // succeed for this row — revoke instead of poisoning every future send
        if (!code && /should be|must be|invalid|not valid|curve/i.test(msg)) {
          revoked++
          await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) }).catch(() => {})
          continue
        }
        // permanent failures (gone/malformed/unauthorized registration) → revoke;
        // 5xx/timeouts are transient → keep the subscription (§17)
        if (code === 404 || code === 410 || code === 400 || code === 401 || code === 403) {
          revoked++
          await rest(`push_subscriptions?id=eq.${s.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ revoked_at: new Date().toISOString() }) }).catch(() => {})
        } else {
          failed++
        }
      }
    }
    return json({ sent, revoked, failed, subscriptions: subs.length, codes })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
