// paymongo-webhook — the ONLY authority that marks a payment paid.
//
// RETRY CORRECTNESS: provider_events distinguishes RECEIVED from PROCESSED.
//  - first delivery inserts the event row (PK event_id)
//  - reconciliation runs; only a SUCCESSFUL settle stamps processed_at
//  - a transient failure (provider unsettled, provider read error) returns 5xx
//    and the event stays UNPROCESSED, so the provider's retry of the SAME event
//    id RE-PROCESSES it
//  - once processed, duplicates are harmless acknowledged no-ops
//  - concurrent duplicates cannot double-settle: settlement is idempotent and
//    'already settled' counts as processed
//
// Signature: `Paymongo-Signature: t=<ts>,te=<test-hash>,li=<live-hash>` over
// `${t}.${rawBody}` — te for test events, li for live, selected by the event's
// own data.attributes.livemode (cross-checked against the header token).
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
    const livemode = typeof attrs.livemode === 'boolean' ? attrs.livemode : event.livemode === true

    const sigParts = Object.fromEntries(
      sig.split(',').map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()] }),
    )
    if (typeof sigParts.livemode === 'string' && sigParts.livemode !== String(livemode)) {
      return json({ error: 'mode mismatch between signature and event' }, 401)
    }
    const ok = await verifySignature(sig, rawBody, cfg.webhookSecret, livemode)
    if (!ok) return json({ error: 'bad signature' }, 401)

    // received != processed: claim the event row; an existing row is re-processed
    // only while processed_at is NULL (transient failure on an earlier delivery)
    let isRetry = false
    if (evtId) {
      const ins = await rest<{ event_id: string }>('provider_events', {
        method: 'POST',
        headers: { Prefer: 'return=representation, resolution=ignore-duplicates' },
        body: JSON.stringify([{ event_id: evtId, event_type: evtType, payload: rawBody.slice(0, 2000) }]),
      })
      if (Array.isArray(ins) && ins.length === 0) {
        const prev = await rest<{ processed_at: string | null }>(
          `provider_events?event_id=eq.${encodeURIComponent(evtId)}&select=processed_at`,
        )
        if (prev[0]?.processed_at) return json({ received: true, duplicate: true })
        isRetry = true // unprocessed: this delivery retries the work
      }
    }

    const markProcessed = async () => {
      if (evtId) {
        await rest(`provider_events?event_id=eq.${encodeURIComponent(evtId)}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ processed_at: new Date().toISOString() }),
        }).catch(() => {})
      }
    }

    const inner = attrs.data
    const providerId = typeof inner?.id === 'string' ? inner.id : ''
    const intentId =
      (typeof inner?.attributes?.payment_intent_id === 'string' ? inner.attributes.payment_intent_id : '') ||
      (providerId.startsWith('pi_') ? providerId : '') ||
      (rawBody.match(/pi_[A-Za-z0-9]+/) ?? [''])[0]

    if (intentId) {
      const rows = await rest<{ id: string; status: string }>(`payments?payment_intent_id=eq.${intentId}&select=id,status`)
      const paymentId = rows[0]?.id
      if (paymentId) {
        if (evtType === 'payment.paid') {
          try {
            const r = await reconcile(paymentId, cfg)
            if (r.status === 'paid') {
              await markProcessed()
            } else {
              // provider re-read is not settled yet (event raced provider state)
              // — stay UNPROCESSED and let the retry land the settle
              return json({ error: 'provider not settled yet, will retry', retry: true }, 500)
            }
          } catch (e) {
            // a racing/earlier settle counts as processed; anything else = retry
            const now = await rest<{ status: string }>(`payments?id=eq.${paymentId}&select=status`)
            if (now[0]?.status === 'paid') {
              await markProcessed()
            } else {
              return json({ error: 'reconcile failed, will retry', retry: true, detail: String(e).slice(0, 120) }, 500)
            }
          }
        } else if (evtType === 'payment.failed') {
          await rpc('fn_apply_payment_result', {
            p_payment: paymentId, p_result: 'failed',
            p_failure: 'provider reported payment.failed',
          }).catch(() => null)
          await markProcessed()
        } else if (evtType === 'qrph.expired' || evtType === 'payment.expired') {
          await rpc('fn_apply_payment_result', { p_payment: paymentId, p_result: 'expired' }).catch(() => null)
          await markProcessed()
        } else {
          await markProcessed()
        }
      } else {
        await markProcessed() // nothing links to this event — do not loop forever
      }
    } else {
      await markProcessed()
    }

    return json({ received: true, ...(isRetry ? { reprocessed: true } : {}) })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
