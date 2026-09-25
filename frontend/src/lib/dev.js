import { fnErr } from './api'
// Dev/QA helpers. Build-time gated: Vite replaces VITE_ENABLE_DEV_TOOLS with a
// constant, so with the flag unset every guarded branch below is dead code and
// tree-shaken out of the production bundle (credentials and mockPay included).
// ponytail: demo-grade tooling; delete the guarded branch for a real clinic launch.

const DEV_TOOLS = import.meta.env.VITE_ENABLE_DEV_TOOLS === '1'

// Runtime toggle (?dev=1 persisted to localStorage) — no-ops when DEV_TOOLS is off.
export const isDev = () => DEV_TOOLS && (
  import.meta.env.DEV ||
  new URLSearchParams(location.search).get('dev') === '1' ||
  localStorage.getItem('dv_dev') === '1'
)

if (DEV_TOOLS && new URLSearchParams(location.search).get('dev') === '1') localStorage.setItem('dv_dev', '1')

let DEV_ACCOUNTS = []
let DEV_PW = ''
let mockPayImpl
if (DEV_TOOLS) {
  DEV_ACCOUNTS = [
    { role: 'patient', label: 'Patient · Maria Santos', email: 'maria@dentalvibe.ph' },
    { role: 'doctor', label: 'Doctor · Dr. Ramos', email: 'doctor@dentalvibe.ph' },
    { role: 'owner', label: 'Owner · Dr. Joson', email: 'owner@dentalvibe.ph' },
  ]
  DEV_PW = 'password123'

  // Simulates a completed payment through the live PayMongo edge functions
  // (simulate only works while the mock provider is active server-side).
  mockPayImpl = async (supabase, appointmentId) => {
    const { data, error } = await supabase.functions.invoke('paymongo-create', { body: { appointment_id: appointmentId } })
    if (error) throw new Error(await fnErr(error))
    const { error: simError } = await supabase.functions.invoke('paymongo-check', { body: { payment_id: data.payment_id, simulate: 'paid' } })
    if (simError) throw new Error(await fnErr(simError))
  }
} else {
  mockPayImpl = async () => { throw new Error('mockPay is disabled: dev tools are off (set VITE_ENABLE_DEV_TOOLS=1)') }
}

export { DEV_ACCOUNTS, DEV_PW }
export { DEV_TOOLS }
export function mockPay(supabase, appointmentId) { return mockPayImpl(supabase, appointmentId) }

export function devLogout() {
  if (DEV_TOOLS) localStorage.removeItem('dv_dev')
}
