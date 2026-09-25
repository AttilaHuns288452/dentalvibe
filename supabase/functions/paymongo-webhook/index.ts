// paymongo-webhook — the ONLY authority that marks a payment paid.
// Signature-verified (Paymongo-Signature, HMAC-SHA256 over `${t}.${rawBody}`),
// idempotent per event_id (provider_events ledger), amount verified before
// any state change. Duplicate deliveries are acknowledged no-ops.
import { loadCfg, verifySignature, rest, rpc, json, CORS, reconcile } from '../_shared/paymongo.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const rawBody = await req.text()
    const cfg = await loadCfg()
    const sig = req.headers.get('paymongo-signature') ?? req.headers.get('Paymongo-Signature')
    if (!sig) return json({ error: 'missing signature' }, 401)
    // fail closed: an unconfigured secret must never 'verify' anything
    if (!cfg.webhookSecret) return json({ error: 'webhook secret not configured' }, 503)

    let event: {
      id?: string
      type?: string
      livemode?: boolean
      data?: { id?: string; attributes?: { type?: string; data?: { id?: string; attributes?: Record<string, unknown> } } }
    }
    try {
      event = JSON.parse(rawBody)
    } catch {
      return json({ error: 'invalid payload' }, 400)
    }

    // envelope: { data: { id: evt_..., type: 'event', attributes: { type: 'payment.paid', data: {...} } } }
    const evt = event.data ?? {}
    const evtId: string = (evt.id as string) ?? ''
    const evtType: string = (evt.attributes?.type as string) ?? (event.type as string) ?? ''
    const livemode = !!(evt as { livemode?: boolean }).livemode ?? false

    const ok = await verifySignature(sig, rawBody, cfg.webhookSecret, livemode || event.livemode === true)
    if (!ok) return json({ error: 'bad signature' }, 401)

    // idempotency: first delivery inserts the event; replays are acked no-ops
    if (evtId) {
      const dup = await rest('provider_events', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify([{ event_id: evtId, event_type: evtType, payload: rawBody.slice(0, 2000) }]),
      }).catch(() => [{ duplicate: true }])
      if (Array.isArray(dup) && dup.length === 0) return json({ received: true, duplicate: true })
    }

    // find our payment by the provider payment/intent id embedded in the event
    const inner = evt.attributes?.data
    const providerId: string = (inner?.id as string) ?? ''
    const intentId: string =
      (inner?.attributes?.payment_intent_id as string) ??
      (providerId.startsWith('pi_') ? providerId : '') ??
      ''
    // fallback: any pi_* id anywhere in the snapshot links through the unique index
    const fallbackId = intentId || (rawBody.match(/pi_[A-Za-z0-9]+/) ?? [''])[0]

    if (fallbackId) {
      const rows = await rest<{ id: string }>(
        `payments?payment_intent_id=eq.${fallbackId}&select=id`,
      )
      const paymentId = rows[0]?.id
      if (paymentId) {
        if (evtType === 'payment.paid') {
          // reconcile re-reads the provider intent and verifies amount server-side
          await reconcile(paymentId, cfg)
        } else if (evtType === 'payment.failed') {
          await rpc('fn_apply_payment_result', {
            p_payment: paymentId,
            p_result: 'failed',
            p_failure: 'provider reported payment.failed',
          })
        } else if (evtType === 'qrph.expired' || evtType === 'payment.expired') {
          await rpc('fn_apply_payment_result', { p_payment: paymentId, p_result: 'expired' })
        }
      }
    }

    return json({ received: true })
  } catch (e) {
    // non-2xx → PayMongo retries up to 12x with backoff (per docs)
    return json({ error: String(e) }, 500)
  }
})
