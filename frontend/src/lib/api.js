import { supabase } from '../supabaseClient'

// Supabase data access — every query the app makes, in one place.
// ponytail: no React Query/SWR; components fetch on mount, refresh on action.

export { supabase }

// transport failures may resolve { data: null, error: null } — null data is a failed load, not an empty list
const must = (data, error) => {
  if (error) throw error
  if (data === null) throw new Error("Couldn't load — check your connection.")
  return data
}
export const peso = (v) => '₱' + Number(v ?? 0).toLocaleString('en-US')

// ---- auth ----
export async function getSession() {
  const { data } = await supabase.auth.getSession()
  return data.session ?? null
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  return must(data, error)
}

export async function signUp(email, password, fullName, role, extra = {}) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName, role, ...extra } },
  })
  return must(data, error)
}

export async function signOut() {
  await supabase.removeAllChannels() // drop realtime subs first — avoids 400s on revoked token
  await supabase.auth.signOut()
}

export async function getProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return must(data, error)
}

export async function getMyPatientRecord(userId) {
  // patient-safe columns only — medical_note/patient_code are staff-only at the column level
  const { data, error } = await supabase
    .from('patients')
    .select('id, user_id, full_name, email, phone, birthdate, sex, address, emergency_contact, created_at')
    .eq('user_id', userId)
    .maybeSingle()
  return must(data, error)
}

// ---- catalog / settings (public read) ----
export async function listServices() {
  const { data, error } = await supabase.from('services').select('*').order('price')
  return must(data, error) ?? []
}

export async function getClinicSettings() {
  const { data, error } = await supabase.from('clinic_settings').select('*').eq('id', 1).single()
  return must(data, error)
}

export async function updateClinicSettings(patch) {
  const { error } = await supabase.from('clinic_settings').update(patch).eq('id', 1)
  if (error) throw error
}

// ---- services (owner) ----
export async function createService(name, price, durationMinutes) {
  const { error } = await supabase.from('services').insert({ name, price, duration_minutes: durationMinutes })
  if (error) throw error
}

export async function deleteService(id) {
  const { error } = await supabase.from('services').delete().eq('id', id)
  if (error) throw error
}

// ---- price exceptions (owner) ----
export async function listPriceExceptions(serviceId) {
  const { data, error } = await supabase
    .from('service_prices')
    .select('patient_id, price')
    .eq('service_id', serviceId)
  return must(data, error) ?? []
}

export async function upsertPriceException(serviceId, patientId, price) {
  const { error } = await supabase
    .from('service_prices')
    .upsert({ service_id: serviceId, patient_id: patientId, price }, { onConflict: 'service_id,patient_id' })
  if (error) throw error
}

export async function deletePriceException(serviceId, patientId) {
  const { error } = await supabase
    .from('service_prices')
    .delete()
    .eq('service_id', serviceId)
    .eq('patient_id', patientId)
  if (error) throw error
}

// effective price for one patient+service: exception wins over base
export async function getEffectivePrice(patientId, serviceId, basePrice) {
  const { data } = await supabase
    .from('service_prices')
    .select('price')
    .eq('service_id', serviceId)
    .eq('patient_id', patientId)
    .maybeSingle()
  return data?.price ?? basePrice
}

// ---- patients (staff) ----
export async function listPatients() {
  const { data, error } = await supabase
    .from('staff_patients')
    .select('*')
    .order('full_name')
  return must(data, error) ?? []
}

// ---- appointments ----
export async function bookAppointment({ patientId, serviceId, serviceIds, requestedDate, scheduledAt, durationMinutes, notes, price }) {
  const { data, error } = await supabase
    .from('appointments')
    .insert({ patient_id: patientId, service_id: serviceId, service_ids: serviceIds, requested_date: requestedDate, scheduled_at: scheduledAt, duration_minutes: durationMinutes, notes, price, status: 'pending' })
    .select()
    .single()
  return must(data, error)
}

export async function listAppointments() {
  const { data, error } = await supabase
    .from('appointments')
    .select('*, patients(full_name), dentists(full_name), services(name, price)')
    .order('created_at', { ascending: false })
  return must(data, error) ?? []
}

export async function listMyAppointments(patientId) {
  const { data, error } = await supabase
    .from('appointments')
    .select('*, patients(full_name), dentists(full_name), services(name, price)')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
  return must(data, error) ?? []
}

export async function setAppointmentStatus(id, status, extra = {}) {
  const { error } = await supabase
    .from('appointments')
    .update({ status, ...extra })
    .eq('id', id)
  if (error) throw error
}

// ---- chat ----
export async function listChat(patientId) {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('patient_id', patientId)
    .order('created_at')
  return must(data, error) ?? []
}

export async function sendChat(patientId, sender, body) {
  const { error } = await supabase.from('chat_messages').insert({ patient_id: patientId, sender, body })
  if (error) throw error
}

export function subscribeChat(patientId, onInsert) {
  const channel = supabase
    .channel(`chat-${patientId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `patient_id=eq.${patientId}` },
      (payload) => onInsert(payload.new),
    )
    .subscribe()
  return () => supabase.removeChannel(channel)
}
