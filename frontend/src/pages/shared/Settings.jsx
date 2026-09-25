import { useEffect, useState } from 'react'
import { useUnsavedGuard, useSubmit } from '../../lib/hooks'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { supabase, getClinicSettings } from '../../lib/api'
import { fmtTime12 } from '../../lib/format'

// Settings (Figma p81/91/102 — owner): profile card w/ Owner pill, MY PROFILE
// fields + Save, CLINIC PROFILE fields + Save, ACCOUNT rows (Change Password /
// Log Out). Dentist variant drops CLINIC PROFILE.

export default function Settings() {
  const navigate = useNavigate()
  const { profile, patientRecord, logout } = useAuth()
  const isOwner = profile?.role === 'owner'
  const [p, setP] = useState({ first: '', last: '', address: '', contact: '' })
  const [clinic, setClinic] = useState({ name: '', email: '', hours: '' })
  const [savedP, setSavedP] = useState(false)
  const [savedC, setSavedC] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const parts = (profile?.full_name ?? '').split(' ')
    setP({
      first: parts[0] ?? '', last: parts.slice(1).join(' ') ?? '',
      address: patientRecord?.address ?? '', contact: patientRecord?.phone ?? profile?.phone ?? '',
    })
    getClinicSettings().then((s) => {
      setClinic({
        name: s?.clinic_name || 'D.A.R. Dental Clinic',
        email: s?.clinic_email ?? 'dr.joson@dardenal.ph',
        hours: `${fmtTime12(s?.open_time ?? '10:00')} – ${fmtTime12(s?.close_time ?? '17:00')}`,
      })
    }).catch((e) => setErr(e?.message || "Couldn't load clinic info — check your connection."))
  }, [profile?.full_name, patientRecord?.id])

  const initials = (profile?.full_name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('')

  useUnsavedGuard(p.first !== (profile?.full_name ?? '').split(' ')[0] || (p.last || '') !== (profile?.full_name ?? '').split(' ').slice(1).join(' '))
  const saveProfileImpl = async () => {
    setErr(''); setSavedP(false); setBusy(true)
    const full = `${p.first} ${p.last}`.trim()
    const { error } = await supabase.from('profiles').update({ full_name: full }).eq('id', profile.id)
    if (!error && patientRecord?.id) {
      await supabase.from('patients').update({ address: p.address, phone: p.contact }).eq('id', patientRecord.id)
    }
    setBusy(false)
    if (error) return setErr(error.message)
    setSavedP(true)
  }
  const [saveProfile, profBusy] = useSubmit(saveProfileImpl)

  const saveClinic = async () => {
    setErr(''); setSavedC(false); setBusy(true)
    // parse 'Mon – Sat : 8:00 AM – 5:00 PM' style hours field into open/close times
    const m = clinic.hours.match(/(\d{1,2}:\d{2})\s*(AM|PM)?.*[–-].*(\d{1,2}:\d{2})\s*(AM|PM)?/i)
    const to24 = (t, ap) => {
      if (!t) return null
      let [h, mi] = t.split(':').map(Number)
      if (ap === 'PM' && h < 12) h += 12
      if (ap === 'AM' && h === 12) h = 0
      return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
    }
    const payload = { clinic_name: clinic.name, clinic_email: clinic.email }
    if (m) { payload.open_time = to24(m[1], (m[2] || '').toUpperCase()); payload.close_time = to24(m[3], (m[4] || '').toUpperCase()) }
    const { data: cur } = await supabase.from('clinic_settings').select('id').limit(1)
    if (cur?.[0]) await supabase.from('clinic_settings').update(payload).eq('id', cur[0].id)
    else await supabase.from('clinic_settings').insert(payload)
    setBusy(false)
    setSavedC(true)
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-xs text-gray-500">Profile &amp; account</p>
      </div>

      {/* profile card */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <span className="w-11 h-11 rounded-full bg-primary-50 text-primary-700 text-sm font-bold flex items-center justify-center flex-none">{initials}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-gray-900 truncate">{profile?.full_name}</span>
          <span className="block text-xs text-gray-500 truncate">{profile?.email ?? '—'}</span>
        </span>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-primary-50 text-primary-700 capitalize flex-none">{profile?.role}</span>
      </div>

      {/* MY PROFILE */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">My profile</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-500">First name</span>
              <input value={p.first} onChange={(e) => setP((v) => ({ ...v, first: e.target.value }))} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-500">Last name</span>
              <input value={p.last} onChange={(e) => setP((v) => ({ ...v, last: e.target.value }))} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-500">Home address</span>
            <input value={p.address} onChange={(e) => setP((v) => ({ ...v, address: e.target.value }))} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-500">Contact number</span>
            <input value={p.contact} onChange={(e) => setP((v) => ({ ...v, contact: e.target.value }))} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          {savedP && <p className="text-xs text-green-600">Saved ✓</p>}
          <button onClick={saveProfile} disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">Save Changes</button>
        </div>
      </section>

      {/* CLINIC PROFILE (owner only — Figma p81) */}
      {isOwner && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Clinic profile</h2>
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
            <label className="block"><span className="text-xs font-medium text-gray-500">Clinic name</span>
              <input value={clinic.name} onChange={(e) => setClinic((v) => ({ ...v, name: e.target.value }))} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-500">Email</span>
              <input value={clinic.email} onChange={(e) => setClinic((v) => ({ ...v, email: e.target.value }))} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-500">Hours</span>
              <input value={clinic.hours} onChange={(e) => setClinic((v) => ({ ...v, hours: e.target.value }))} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            {savedC && <p className="text-xs text-green-600">Saved ✓</p>}
            <button onClick={saveClinic} disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">Save Changes</button>
          </div>
        </section>
      )}

      {/* ACCOUNT */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Account</h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          <button onClick={() => navigate('/security')} className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
            <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 w-5 h-5 text-gray-600 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" /></svg>
            <span className="text-sm font-semibold text-gray-900">Change Password</span>
          </button>
          <button onClick={logout} className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
            <svg viewBox="0 0 24 24" className="w-5 h-5 text-red-500 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
            <span className="text-sm font-semibold text-red-500">Log Out</span>
          </button>
        </div>
      </section>

      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  )
}
