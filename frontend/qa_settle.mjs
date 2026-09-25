// Settle a booking's payment the way PRODUCTION does it — provider-side
// confirmation through paymongo-check, no dev UI involved (dev tools are
// absent from production builds by design).
// Run from frontend/; needs .env.local + the test provider mode.
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

export async function settleAppointment({ appointmentId, email = 'maria@dentalvibe.ph', password = 'password123', simulate = 'paid' }) {
  const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').trim().split('\n').map((l) => l.split('=')))
  const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
  await sb.auth.signInWithPassword({ email, password })
  let pay = null
  for (let i = 0; i < 15 && !pay; i++) {
    const { data } = await sb.from('payments').select('id').eq('appointment_id', appointmentId).eq('status', 'pending').order('created_at', { ascending: false }).limit(1).maybeSingle()
    pay = data
    if (!pay) await new Promise((r) => setTimeout(r, 1000)) // paymongo-create runs on QR mount — give it time
  }
  if (!pay) return { ok: false, reason: 'no pending payment after wait' }
  const { data, error } = await sb.functions.invoke('paymongo-check', { body: { payment_id: pay.id, simulate } })
  return { ok: !error && data?.status === 'paid', status: data?.status ?? null, error: error?.message ?? data?.error ?? null }
}
