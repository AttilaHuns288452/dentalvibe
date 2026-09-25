// paymongo-check — status lookup + reconciliation where a webhook is late/lost.
// `simulate` is DEV/TEST only: mock mode settles directly; test mode drives the
// documented PayMongo test_url simulation (sources/:id/charge|fail|expire) and
// lets the real signed webhook + reconcile do the settling. NEVER in live mode.
import { loadCfg, rest, rpc, json, CORS, reconcile, simulateViaTestUrl } from '../_shared/paymongo.ts'

type CheckBody = { payment_id?: string; simulate?: 'paid' | 'failed' | 'expired' }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'missing auth' }, 401)
    const { payment_id, simulate } = (await req.json()) as CheckBody
    if (!payment_id) return json({ error: 'payment_id required' }, 400)

    const cfg = await loadCfg()

    const userRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: `Bearer ${jwt}` },
    })
    if (!userRes.ok) return json({ error: 'invalid session' }, 401)
    const user = await userRes.json()

    const rows = await rest<{ id: string; status: string; appointment_id: string; expires_at: string | null; amount: number; payment_intent_id: string | null; test_url: string | null }>(
      `payments?id=eq.${payment_id}&select=id,status,appointment_id,expires_at,amount,payment_intent_id,test_url`,
    )
    const payment = rows[0]
    if (!payment) return json({ error: 'payment not found' }, 404)

    const owned = await rest<{ id: string }>(`patients?user_id=eq.${user.id}&select=id`)
    if (!owned.length) return json({ error: 'not authorized' }, 403)
    const ownAppt = await rest<{ id: string }>(`appointments?id=eq.${payment.appointment_id}&patient_id=eq.${owned[0].id}&select=id`)
    if (!ownAppt.length) return json({ error: 'not authorized' }, 403)

    if (simulate) {
      if (cfg.mode === 'live') return json({ error: 'simulate unavailable' }, 403)
      if (payment.status !== 'pending') return json({ status: payment.status })
      if (cfg.mode === 'test' && payment.test_url) {
        // documented sandbox simulation — PayMongo then sends the REAL signed webhook
        const kind = simulate === 'paid' ? 'charge' : simulate === 'failed' ? 'fail' : 'expire'
        try {
          await simulateViaTestUrl(payment.test_url, kind)
        } catch (e) {
          // source already expired/failed at the provider = that IS the outcome
          if (!/already expired|already failed|invalid/i.test(String(e))) throw e
        }
        if (simulate === 'paid') {
          // settle via the real signed webhook; reconcile covers delivery gaps
          await new Promise((r) => setTimeout(r, 2500))
          await reconcile(payment_id, cfg).catch(() => {})
        } else {
          // fail/expire are source-level: no payment.* event fires, settle here
          await rpc('fn_apply_payment_result', { p_payment: payment_id, p_result: simulate, p_provider_status: 'test_url_' + kind })
        }
      } else {
        await rpc('fn_apply_payment_result', { p_payment: payment_id, p_result: simulate, p_provider_status: 'mock_' + simulate })
      }
    } else {
      if (payment.status === 'pending' && payment.expires_at && new Date(payment.expires_at) < new Date()) {
        await rpc('fn_apply_payment_result', { p_payment: payment_id, p_result: 'expired' })
      } else {
        await reconcile(payment_id, cfg)
      }
    }

    const after = await rest<{ status: string }>(`payments?id=eq.${payment_id}&select=status`)
    return json({ status: after[0]?.status ?? 'unknown' })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
