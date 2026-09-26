// Shared PayMongo helpers — paymongo-create / paymongo-webhook / paymongo-check.
// Secrets resolve from Deno.env first, then payment_provider_config (service-role only).
// Modes: 'mock' (no keys, simulated settle) | 'test' (test keys + test_url sim) |
//        'live' (live keys — never simulated).
export type Cfg = {
  mode: 'mock' | 'test' | 'live'
  secretKey: string
  webhookSecret: string
  qrStyle: 'dynamic' | 'instore'
  merchantQr: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const svcAuth = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY }

export async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...svcAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${fn} failed: ${res.status} ${text}`)
  return text ? JSON.parse(text) : null
}

export async function rest<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { ...svcAuth, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`rest ${path} failed: ${res.status} ${text}`)
  return text ? (JSON.parse(text) as T[]) : []
}

export async function loadCfg(): Promise<Cfg> {
  const rows = await rest<{ key: string; value: string }>('payment_provider_config?select=key,value')
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  const secretKey = Deno.env.get('PAYMONGO_SECRET_KEY') ?? map.paymongo_secret_key ?? ''
  const webhookSecret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET') ?? map.paymongo_webhook_secret ?? ''
  // FAIL CLOSED: the mode must be EXPLICIT. A secret key alone never implies live —
  // forgetting PAYMONGO_MODE must never silently move real money. Unknown → mock.
  const raw = (Deno.env.get('PAYMONGO_MODE') ?? map.provider_mode ?? '').toLowerCase()
  const mode: Cfg['mode'] = raw === 'live' || raw === 'test' || raw === 'mock' ? raw : 'mock'
  // a money mode without keys degrades to mock (safe direction), never the reverse
  return {
    mode: mode !== 'mock' && !secretKey ? 'mock' : mode,
    secretKey,
    webhookSecret,
    qrStyle: (map.qr_style === 'instore' ? 'instore' : 'dynamic') as Cfg['qrStyle'],
    merchantQr: map.merchant_qr_image ?? '/merchant-qr.jpg',
  }
}

// ── signature verification: HMAC-SHA256 over `${t}.${rawBody}` ──────────────
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifySignature(header: string, rawBody: string, secret: string, livemode: boolean, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  const parts = Object.fromEntries(header.split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()] }))
  const t = Number(parts.t)
  if (!Number.isFinite(t)) return false
  if (Math.abs(nowSec - t) > 300) return false
  const expected = livemode ? parts.li : parts.te
  if (!expected) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`))
  return timingSafeEqual([...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join(''), expected)
}

// ── PayMongo API ────────────────────────────────────────────────────────────
export async function paymongo<T>(path: string, secretKey: string, init: RequestInit = {}): Promise<T> {
  // one bounded retry on transient provider failures (network / 5xx) — measured
  // ~1% transient rate on the test API; reads are safe to repeat and the DB
  // payment-row reuse keeps creates idempotent across retries
  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.paymongo.com/v1/${path}`, {
        ...init,
        headers: { Authorization: 'Basic ' + btoa(`${secretKey}:`), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
      })
      const body = await res.json()
      if (res.ok) return body as T
      if (res.status < 500) throw new Error(`paymongo ${path}: ${res.status} ${body?.errors?.[0]?.detail ?? JSON.stringify(body)}`)
      lastErr = `paymongo ${path}: ${res.status}`
    } catch (e) {
      if (String(e).includes('paymongo ')) throw e // definitive 4xx — do not retry
      lastErr = String(e).slice(0, 120)
    }
    await new Promise((r) => setTimeout(r, 1200))
  }
  throw new Error(lastErr)
}

export type Intent = { data: { id: string; attributes: { amount: number; status: string; currency: string; client_key: string } } }

// documented test-mode simulation: the test_url carries ?id=src_...&code_id=qr_...
export async function simulateViaTestUrl(testUrl: string, kind: 'charge' | 'fail' | 'expire'): Promise<void> {
  const u = new URL(testUrl)
  const sourceId = u.searchParams.get('id')
  if (!sourceId) throw new Error('bad test_url')
  const body: Record<string, unknown> = {}
  const codeId = u.searchParams.get('code_id')
  if (codeId) body.code_id = codeId
  const res = await fetch(`https://secure-authentication-api.paymongo.com/sources/${sourceId}/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`simulate ${kind}: ${res.status} ${await res.text()}`)
}

// ── reconcile: provider read is the authority, webhook is the trigger ───────
export async function reconcile(paymentId: string, cfg: Cfg): Promise<{ status: string }> {
  const [row] = await rest<{ id: string; status: string; payment_intent_id: string | null; amount: number }>(
    `payments?id=eq.${paymentId}&select=id,status,payment_intent_id,amount`,
  )
  if (!row) throw new Error('payment not found')
  if (row.status === 'paid') return { status: 'paid' }

  // mock intents never hit the payments API — the internal state machine is the authority
  if (cfg.mode === 'mock' || !row.payment_intent_id || row.payment_intent_id.startsWith('pi_mock_')) return { status: row.status }

  const intent = await paymongo<Intent>(`payment_intents/${row.payment_intent_id}`, cfg.secretKey)
  const s = intent.data.attributes.status
  if (s === 'succeeded') {
    await rpc('fn_apply_payment_result', {
      p_payment: paymentId,
      p_result: 'paid',
      p_provider_status: s,
      p_amount_centavos: intent.data.attributes.amount,
      p_currency: intent.data.attributes.currency,
    })
    return { status: 'paid' }
  }
  return { status: row.status }
}

export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, paymongo-signature',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}
