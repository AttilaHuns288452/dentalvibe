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

const MOCK_RECEIPT =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

// Mock GCash payment — runs the REAL fn_submit_payment_proof path (instant confirm + income)
export async function mockPay(supabase, appointmentId) {
  const { error } = await supabase.rpc('fn_submit_payment_proof', {
    p_appointment: appointmentId,
    p_image: MOCK_RECEIPT,
  })
  if (error) throw error
}

export function devLogout() {
  localStorage.removeItem('dv_dev')
}
