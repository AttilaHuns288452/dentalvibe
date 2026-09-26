import { supabase } from './api'
import { manilaDayKey, manilaToInstant } from './availability'

// Multi-dentist capacity helpers (read-only except setMyReady).
// Availability policy mirrors fn_dentist_available: an ACTIVE dentist is available
// for a clinic date UNLESS a ready=false row exists; ready=true makes it explicit.
// Free/busy mirrors fn_dentist_free: a reserved overlap is payment_status
// pending/paid and status <> cancelled. Nothing here assigns dentists — the DB
// trigger (fn_appt_dentist_guard) does that at insert.

// Active dentists joined with their dentist_ready row for a clinic date.
// ready: true (explicit Ready) | false (Not Ready) | null (no row — available by default).
export async function readyStateForDate(dateISO) {
  const [{ data: dentists, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    supabase.from('dentists').select('id, full_name, email, active').eq('active', true).order('full_name'),
    supabase.from('dentist_ready').select('dentist_id, ready, ready_at').eq('clinic_date', dateISO),
  ])
  if (e1) throw e1
  if (e2) throw e2
  // Patients cannot read dentists rows (RLS is doctor/owner/self by design) —
  // fall back to the id-only RPC so capacity-aware slots still compute.
  if (!(dentists ?? []).length) {
    const { data: ids, error: e3 } = await supabase.rpc('fn_available_dentist_ids', { p_date: dateISO })
    if (e3) throw e3
    return (ids ?? []).map((id) => ({ id, ready: null, ready_at: null }))
  }
  const byId = Object.fromEntries((rows ?? []).map((r) => [r.dentist_id, r]))
  return (dentists ?? []).map((d) => ({ ...d, ready: byId[d.id]?.ready ?? null, ready_at: byId[d.id]?.ready_at ?? null }))
}

// The dentists row for the signed-in user (dentists.email matches the auth email).
export async function myDentist() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null
  const { data, error } = await supabase
    .from('dentists')
    .select('id, full_name, email, active')
    .eq('email', user.email)
    .maybeSingle()
  if (error) throw error
  return data
}

// Upsert my own Ready row for Manila today (ready_at stamps the Ready moment).
export async function setMyReady(ready) {
  const me = await myDentist()
  if (!me) throw new Error('No dentist profile linked to this account.')
  const { error } = await supabase.from('dentist_ready').upsert(
    {
      dentist_id: me.id,
      clinic_date: manilaDayKey(new Date()),
      ready,
      ready_at: ready ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'dentist_id,clinic_date' },
  )
  if (error) throw error
}

// How many dentists can see patients on this date (active, no ready=false row).
export async function capacityForDate(dateISO) {
  return (await readyStateForDate(dateISO)).filter((d) => d.ready !== false).length
}

// Reserved (pending/paid, not cancelled) visits on a clinic date, as instants.
const reservedOn = async (dateISO) => {
  const from = manilaToInstant(dateISO, '00:00')
  const to = new Date(from.getTime() + 864e5) // Manila has no DST: a day is exactly 24h
  const { data, error } = await supabase
    .from('appointments')
    .select('dentist_id, scheduled_at, duration_minutes')
    .in('payment_status', ['pending', 'paid'])
    .neq('status', 'cancelled')
    .gte('scheduled_at', from.toISOString())
    .lt('scheduled_at', to.toISOString())
  if (error) throw error
  return (data ?? []).filter((r) => r.dentist_id && r.scheduled_at)
}

// Dentists free for the whole [start, start+mins) window at 'HH:MM' on dateISO —
// fn_dentist_free applied per dentist. Returns [{id, full_name}].
export async function freeDentistsFor(dateISO, startHHMM, mins) {
  const [state, reserved] = await Promise.all([readyStateForDate(dateISO), reservedOn(dateISO)])
  const start = manilaToInstant(dateISO, startHHMM).getTime()
  const end = start + mins * 60000
  return state
    .filter((d) => d.ready !== false)
    .filter((d) => !reserved.some((r) => {
      const rs = new Date(r.scheduled_at).getTime()
      const re = rs + (r.duration_minutes ?? 30) * 60000
      return r.dentist_id === d.id && start < re && rs < end
    }))
    .map(({ id, full_name }) => ({ id, full_name }))
}
