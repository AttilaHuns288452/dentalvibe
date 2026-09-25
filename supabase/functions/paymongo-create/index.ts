// paymongo-create — patient requests payment for their own appointment.
// Modes (payment_provider_config.provider_mode):
//   mock  → fake provider (pi_mock_*), simulated settle; internal flow unchanged
//   test  → REAL PayMongo test API: PaymentIntent + qrph attach → dynamic QR +
//           test_url (documented sandbox simulation). No real money.
//   live  → same API with live keys (in-store QRPh product: static merchant QR
//           returned instead of a per-payment intent when qr_style='instore')
// Secret key NEVER leaves this function.
import { loadCfg, paymongo, rest, rpc, json, CORS, type Intent } from '../_shared/paymongo.ts'

type CreateBody = { appointment_id?: string }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer /, '')
    if (!jwt) return json({ error: 'missing auth' }, 401)

    const { appointment_id } = (await req.json()) as CreateBody
    if (!appointment_id) return json({ error: 'appointment_id required' }, 400)

    const cfg = await loadCfg()

    const userRes = await fetch(`${Deno.env.get('SUPABASE_URL')}/auth/v1/user`, {
      headers: { apikey: Deno.env.get('SUPABASE_ANON_KEY')!, Authorization: `Bearer ${jwt}` },
    })
    if (!userRes.ok) return json({ error: 'invalid session' }, 401)
    const user = await userRes.json()

    const patients = await rest<{ id: string }>(`patients?user_id=eq.${user.id}&select=id`)
    if (!patients.length) return json({ error: 'not a patient' }, 403)

    const appts = await rest<{ id: string; price: number; status: string; payment_status: string; scheduled_at: string }>(
      `appointments?id=eq.${appointment_id}&patient_id=eq.${patients[0].id}&select=id,price,status,payment_status,scheduled_at`,
    )
    const appt = appts[0]
    if (!appt) return json({ error: 'appointment not found' }, 404)
    if (appt.status === 'cancelled') return json({ error: 'appointment not payable' }, 409)

    // idempotent FIRST: retried create must return the open payment, not 409
    const existing = await rest<{ id: string; status: string; payment_intent_id: string | null; qr_image: string | null; qr_payload: string | null; test_url: string | null; expires_at: string | null; amount: number; reference: string | null }>(
      `payments?appointment_id=eq.${appointment_id}&status=in.(pending,paid)&select=id,status,payment_intent_id,qr_image,qr_payload,test_url,expires_at,amount,reference`,
    )
    if (existing.length) {
      const p = existing[0]
      if (!p.expires_at || new Date(p.expires_at) > new Date()) {
        return json({ payment_id: p.id, status: p.status, qr_image: p.qr_image, qr_payload: p.qr_payload, test_url: p.test_url, expires_at: p.expires_at, amount: p.amount, reference: p.reference, reused: true })
      }
      await rpc('fn_apply_payment_result', { p_payment: p.id, p_result: 'expired' })
    }

    if (appt.payment_status === 'paid') {
      const paidP = await rest<{ id: string; amount: number }>(`payments?appointment_id=eq.${appointment_id}&status=eq.paid&select=id,amount&limit=1`)
      return json({ payment_id: paidP[0]?.id ?? null, status: 'paid', amount: Number(appt.price), qr_image: null, qr_payload: null, reused: true })
    }
    if (appt.status !== 'pending' || appt.payment_status !== 'unpaid')
      return json({ error: 'appointment not payable' }, 409)
    if (!appt.price || Number(appt.price) <= 0)
      return json({ error: 'appointment has no amount due' }, 409)

    // reserve the slot FIRST — per-day advisory lock + overlap rejection
    try {
      await rpc('fn_set_payment_projection', { p_appointment: appointment_id, p_status: 'pending' })
    } catch (e) {
      return json({ error: String(e).replace(/^Error: /, '') }, 409)
    }

    const amountCentavos = Math.round(Number(appt.price) * 100)
    let paymentIntentId: string | null = null
    let clientKey: string | null = null
    let qrImage: string | null = null
    let qrPayload: string | null = null
    let testUrl: string | null = null
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString()
    // payer-facing reference (in-store static QR: customer enters the amount,
    // this reference + amount matching link the webhook back to this record)
    const reference = 'DVR-' + appointment_id.slice(0, 8).toUpperCase()

    if (cfg.mode !== 'mock' && cfg.secretKey) {
      if (cfg.qrStyle === 'instore') {
        // In-store QRPh product: static, permanent merchant QR (customer enters
        // the amount). No per-payment provider object exists at creation — the
        // signed webhook + reconciliation settle it.
        qrImage = cfg.merchantQr
      } else {
        // dynamic QR Ph — per-payment intent, amount encoded (Payment Acceptance API)
        const intent = await paymongo<{ data: { id: string; attributes: { client_key: string } } }>('payment_intents', cfg.secretKey, {
          method: 'POST',
          body: JSON.stringify({
            data: {
              attributes: {
                amount: amountCentavos,
                currency: 'PHP',
                payment_method_allowed: ['qrph'],
                description: `DentalVibe ${reference}`,
                metadata: { internal_payment_ref: reference },
              },
            },
          }),
        })
        paymentIntentId = intent.data.id
        clientKey = intent.data.attributes.client_key

        const pm = await paymongo<{ data: { id: string } }>('payment_methods', cfg.secretKey, {
          method: 'POST',
          body: JSON.stringify({ data: { attributes: { type: 'qrph' } } }),
        })

        const attached = await paymongo<Intent & { data: { attributes: { next_action?: { code?: { image_url?: string; test_url?: string } } } } }>(
          `payment_intents/${paymentIntentId}/attach`,
          cfg.secretKey,
          {
            method: 'POST',
            body: JSON.stringify({ data: { attributes: { payment_method: pm.data.id, client_key: clientKey } } }),
          },
        )
        const code = attached.data.attributes.next_action?.code
        qrImage = code?.image_url ?? null
        testUrl = code?.test_url ?? null
        if (!qrImage) return json({ error: 'provider did not return a QR' }, 502)
      }
    } else {
      // mock provider: fake external destination ONLY — internal flow unchanged
      paymentIntentId = 'pi_mock_' + crypto.randomUUID().replaceAll('-', '')
      clientKey = paymentIntentId + '_client_mock'
      qrPayload = `DENTALVIBE-DEMO-PAYMENT (mock) ref=${paymentIntentId.slice(0, 16)} php=${Number(appt.price).toFixed(2)}`
    }

    let paymentId: string
    try {
      const inserted = await rest<{ id: string }>('payments', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify([
          {
            appointment_id,
            provider: cfg.mode === 'mock' ? 'mock' : 'paymongo',
            payment_intent_id: paymentIntentId,
            client_key: clientKey,
            qr_image: qrImage,
            qr_payload: qrPayload,
            test_url: testUrl,
            reference,
            amount: Number(appt.price),
            status: 'pending',
            provider_status: 'awaiting_next_action',
            expires_at: expiresAt,
          },
        ]),
      })
      paymentId = inserted[0].id
    } catch (e) {
      // concurrent twin (double-click) lost the payments_active_pending race
      const twin = await rest<{ id: string; qr_image: string | null; qr_payload: string | null; test_url: string | null; expires_at: string | null; amount: number; reference: string | null }>(
        `payments?appointment_id=eq.${appointment_id}&status=in.(pending)&select=id,status,qr_image,qr_payload,test_url,expires_at,amount,reference`,
      ).catch(() => [])
      if (twin.length) {
        const p = twin[0]
        return json({ payment_id: p.id, status: p.status, qr_image: p.qr_image, qr_payload: p.qr_payload, test_url: p.test_url, expires_at: p.expires_at, amount: p.amount, reference: p.reference, reused: true })
      }
      await rpc('fn_set_payment_projection', { p_appointment: appointment_id, p_status: 'unpaid' }).catch(() => {})
      throw e
    }

    return json({ payment_id: paymentId, status: 'pending', qr_image: qrImage, qr_payload: qrPayload, test_url: testUrl, expires_at: expiresAt, amount: Number(appt.price), reference })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
