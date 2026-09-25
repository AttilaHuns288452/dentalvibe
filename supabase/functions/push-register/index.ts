// push-register — authenticated PushSubscription management.
// Identity comes ONLY from the verified session (§19): the user can register,
// refresh, or revoke THEIR OWN device subscriptions and nothing else.
// One user = many devices: rows are keyed by endpoint (unique), so a second
// device adds a row and an account switch on the same device REASSIGNS the
// endpoint's row to the current user (no cross-user delivery).
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
  if (req.method === 'OPTIONS') return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'missing auth' }, 401)
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + jwt },
    })
    if (!userRes.ok) return json({ error: 'invalid session' }, 401)
    const user = await userRes.json()

    const body = await req.json()
    const endpoint = String(body?.endpoint ?? '')
    if (!endpoint) return json({ error: 'endpoint required' }, 400)

    if (body.action === 'unregister') {
      // logout / explicit disable: revoke THIS DEVICE's subscription
      await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ revoked_at: new Date().toISOString() }),
      })
      return json({ ok: true, revoked: true })
    }

    const p256dh = String(body?.keys?.p256dh ?? '')
    const auth = String(body?.keys?.auth ?? '')
    if (!p256dh || !auth) return json({ error: 'keys required' }, 400)

    // server-derived user_id — a forged user_id in the body is ignored (§19)
    await rest('push_subscriptions', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: String(body?.user_agent ?? '').slice(0, 200),
        updated_at: new Date().toISOString(),
        revoked_at: null,
      }]),
    })
    return json({ ok: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
