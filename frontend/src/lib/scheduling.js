import { supabase } from './api'
import { manilaDayKey } from './availability'

// Multi-dentist scheduling helpers (read-only except setMyReady).
// BOOKING CAPACITY comes only from dentist_work_schedules (via fn_day_schedule):
// a dentist is a resource on a date iff they are active AND have an active work
// schedule row for that weekday, within those hours. dentist_ready is DAY-OF OPS
// STATE ONLY (doctor/owner views) — it never enables or blocks a booking.
// Nothing here assigns dentists — the DB trigger (fn_appt_dentist_guard) does that.

// Per-dentist working hours on a clinic date (fn_day_schedule): [{id, open, close}]
// with 'HH:MM' times. Authenticated-readable (patients compute slots from it —
// no names/emails leak through the RPC).
export async function dayScheduleForDate(dateISO) {
  const { data, error } = await supabase.rpc('fn_day_schedule', { p_date: dateISO })
  if (error) throw error
  return (data ?? []).map((r) => ({ id: r.dentist_id, open: r.open_time.slice(0, 5), close: r.close_time.slice(0, 5) }))
}

// OPS VIEW ONLY (doctor/owner): active dentists joined with their dentist_ready row
// for a clinic date. ready: true (explicit Ready) | false (Not Ready) | null (no row).
export async function readyStateForDate(dateISO) {
  const [{ data: dentists, error: e1 }, { data: rows, error: e2 }] = await Promise.all([
    supabase.from('dentists').select('id, full_name, email, active').eq('active', true).order('full_name'),
    supabase.from('dentist_ready').select('dentist_id, ready, ready_at').eq('clinic_date', dateISO),
  ])
  if (e1) throw e1
  if (e2) throw e2
  // doctors/owners read dentists rows; the id-only RPC fallback keeps this helper
  // working for any caller that can't (patients use dayScheduleForDate instead).
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
// Ops presence only — bookings ignore it entirely (see header comment).
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
