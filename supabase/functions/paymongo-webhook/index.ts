// paymongo-webhook — the ONLY authority that marks a payment paid.
//
// Official PayMongo event envelope:
//   { data: { id: 'evt_...', type: 'event',
//     attributes: { type: 'payment.paid', livemode: bool, created_at: ts,
//                   data: { id: 'pay_...', type: 'payment',
//                           attributes: { payment_intent_id: 'pi_...', ... } } } } }
// Event mode lives at data.attributes.livemode — NEVER at data.livemode.
//
// Signature: `Paymongo-Signature: t=<ts>,te=<test-hash>,li=<live-hash>` where the
// hashes are HMAC-SHA256 over `${t}.${rawBody}`. te verifies TEST events, li LIVE
// events — selected by the event's own livemode, cross-checked against the
// header's livemode token when present. Fail-closed: missing/invalid signature,
// mode mismatch, or stale timestamp (±300s) → 401.
//
// Idempotency: provider_events (PK event_id) — ONLY the first delivery of an
// event processes; every replay is an acknowledged no-op. At-least-once delivery
// is safe: settlement (fn_apply_payment_result) is itself idempotent per payment.
//
// payment.paid is settled via reconcile(): the provider intent is RE-READ and the
// amount/currency verified server-side before PAID — the event alone is the
// trigger, not the proof.
import { loadCfg, verifySignature, rest, rpc, json, CORS, reconcile } from '../_shared/paymongo.ts'

type Envelope = {
  id?: string
  type?: string
  livemode?: boolean
  attributes?: {
    type?: string
    livemode?: boolean
    data?: { id?: string; attributes?: Record<string, unknown> }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const rawBody = await req.text()
    const cfg = await loadCfg()
    const sig = req.headers.get('paymongo-signature') ?? req.headers.get('Paymongo-Signature')
    if (!sig) return json({ error: 'missing signature' }, 401)
    // fail closed: an unconfigured secret must never 'verify' anything
    if (!cfg.webhookSecret) return json({ error: 'webhook secret not configured' }, 503)

    let event: { data?: Envelope } & Envelope
    try {
      event = JSON.parse(rawBody)
    } catch {
      return json({ error: 'invalid payload' }, 400)
    }

    const evt: Envelope = event.data ?? {}
    const attrs = evt.attributes ?? {}
    const evtId = typeof evt.id === 'string' ? evt.id : ''
    const evtType = typeof attrs.type === 'string' ? attrs.type : typeof event.type === 'string' ? event.type : ''
    // mode: attributes.livemode (official) — legacy top-level fallback, never inferred
    const livemode = typeof attrs.livemode === 'boolean' ? attrs.livemode : event.livemode === true

    // the signature header's own livemode token must agree with the envelope
    const sigParts = Object.fromEntries(
      sig.split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()] }),
    )
    if (typeof sigParts.livemode === 'string' && sigParts.livemode !== String(livemode)) {
      return json({ error: 'mode mismatch between signature and event' }, 401)
    }

    // te for test events, li for live events — wrong-mode signatures cannot verify
    const ok = await verifySignature(sig, rawBody, cfg.webhookSecret, livemode)
    if (!ok) return json({ error: 'bad signature' }, 401)

    // event-id idempotency: first delivery inserts (PK event_id); replays ack no-op
    if (evtId) {
      const ins = await rest('provider_events', {
        method: 'POST',
        headers: { Prefer: 'return=representation, resolution=ignore-duplicates' },
        body: JSON.stringify([{ event_id: evtId, event_type: evtType, payload: rawBody.slice(0, 2000) }]),
      })
      if (Array.isArray(ins) && ins.length === 0) return json({ received: true, duplicate: true })
    }

    // provider resource: the payment object inside attributes.data
    const inner = attrs.data
    const providerId = typeof inner?.id === 'string' ? inner.id : ''
    const intentId =
      (typeof inner?.attributes?.payment_intent_id === 'string' ? inner.attributes.payment_intent_id : '') ||
      (providerId.startsWith('pi_') ? providerId : '') ||
      (rawBody.match(/pi_[A-Za-z0-9]+/) ?? [''])[0]

    if (intentId) {
      const rows = await rest<{ id: string }>(`payments?payment_intent_id=eq.${intentId}&select=id`)
      const paymentId = rows[0]?.id
      if (paymentId) {
        if (evtType === 'payment.paid') {
          // provider re-read + amount/currency verification inside reconcile;
          // failures surface as 5xx so PayMongo retries (bounded, 12x) — safe:
          // settle is idempotent and the event ledger already recorded the delivery
          await reconcile(paymentId, cfg)
        } else if (evtType === 'payment.failed') {
          // late/out-of-order failures after settlement are acked no-ops, never
          // retry storms (settle is authoritative; expired/failed stay re-payable)
          await rpc('fn_apply_payment_result', {
            p_payment: paymentId,
            p_result: 'failed',
            p_failure: 'provider reported payment.failed',
          }).catch(() => null)
        } else if (evtType === 'qrph.expired' || evtType === 'payment.expired') {
          await rpc('fn_apply_payment_result', { p_payment: paymentId, p_result: 'expired' }).catch(() => null)
        }
      }
    }

    return json({ received: true })
  } catch (e) {
    // non-2xx → PayMongo retries up to 12x with backoff (per docs)
    return json({ error: String(e) }, 500)
  }
})
