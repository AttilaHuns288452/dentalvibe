// Dev/QA helpers — active only with ?dev=1 (persisted) or in a Vite dev build.
// ponytail: demo-grade tooling; strip this file for a real clinic launch.

export const isDev = () =>
  import.meta.env.DEV ||
  new URLSearchParams(location.search).get('dev') === '1' ||
  localStorage.getItem('dv_dev') === '1'

if (new URLSearchParams(location.search).get('dev') === '1') localStorage.setItem('dv_dev', '1')

export const DEV_ACCOUNTS = [
  { role: 'patient', label: 'Patient · Maria Santos', email: 'maria@dentalvibe.ph' },
  { role: 'doctor', label: 'Doctor · Dr. Ramos', email: 'doctor@dentalvibe.ph' },
  { role: 'owner', label: 'Owner · Dr. Joson', email: 'owner@dentalvibe.ph' },
]
export const DEV_PW = 'password123'

// Simulates a completed payment through the live PayMongo edge functions
// (simulate only works while the mock provider is active server-side).
export async function mockPay(supabase, appointmentId) {
  const { data, error } = await supabase.functions.invoke('paymongo-create', { body: { appointment_id: appointmentId } })
  if (error) throw error
  const { error: simError } = await supabase.functions.invoke('paymongo-check', { body: { payment_id: data.payment_id, simulate: 'paid' } })
  if (simError) throw simError
}

export function devLogout() {
  localStorage.removeItem('dv_dev')
}
