import Skel from '../../components/Skel'
import useEscape from '../../lib/useEscape'
import { useStickyState , useRevalidateOnVisible } from '../../lib/hooks'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPatients } from '../../lib/api'
import { useAuth } from '../../context/RoleContext'

// Patients (Figma p43/51): count, search, Add New Patient, rows with
// age·sex·code meta + chevron → tap opens the EHR record; chat from there.

const age = (dob) => {
  if (!dob) return null
  const d = new Date(dob)
  return Math.floor((Date.now() - d) / 31557600000)
}

export default function PatientListBase({ title, subtitle }) {
  const [patients, setPatients] = useState(null)
  const [q, setQ] = useStickyState('dv_plb_q', '') // survives Back from a record (#52)
  const [err, setErr] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const navigate = useNavigate()
  const { profile } = useAuth()
  const roleBase = profile?.role === 'patient' ? '' : '/' + profile?.role

  const load = () => listPatients().then(setPatients).catch((e) => setErr(e.message))
  useEffect(() => { load() }, [])

  const filtered = (patients ?? []).filter((p) =>
    p.full_name?.toLowerCase().includes(q.toLowerCase())
    || p.patient_code?.toLowerCase().includes(q.toLowerCase())
    || p.phone?.includes(q))

  return (
    <div className="px-4 py-4 space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <span className="text-xs text-gray-500">{(patients ?? []).length} total</span>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, ID, or phone…"
                 className="w-full h-10 border border-gray-200 rounded-lg pl-9 pr-3 text-sm bg-white" />
        </div>
        <button onClick={() => setShowAdd(true)} className="h-10 px-3 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600 flex items-center gap-1 flex-none">
          <span className="w-4 h-4 rounded-full border border-gray-400 flex items-center justify-center text-[10px] leading-none">+</span> Add New Patient
        </button>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}
      {!patients && <Skel lines={3} h="h-14" />}
      {patients && filtered.length === 0 && <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-6 text-sm text-gray-500 text-center">No patients found.</div>}

      {patients?.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Recent patients</h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {filtered.map((p) => {
              const a = age(p.birthdate)
              return (
                <button key={p.id} onClick={() => navigate(roleBase + '/patients/ehr', { state: { patientId: p.id } })}
                        className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
                  <span className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center flex-none">
                    {(p.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 truncate">{p.full_name}</span>
                    <span className="block text-xs text-gray-500">
                      {[a != null ? a : null, p.sex?.[0]?.toUpperCase(), p.patient_code].filter(Boolean).join(' · ') || p.phone || '—'}
                    </span>
                  </span>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <div className="bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5 text-[11px] text-primary-800 flex gap-2">
        <svg viewBox="0 0 24 24" className="w-4 h-4 flex-none mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M12 12v4" /></svg>
        New patients appear here automatically once they register on the portal.
      </div>

      {showAdd && <AddPatient onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

// Add Patient (Figma p120): staff creates a patient record
function AddPatient({ onClose, onSaved }) {
  const [f, setF] = useState({ full_name: '', birthdate: '', sex: '', phone: '', email: '', emergency_contact: '', medical_note: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    setErr('')
    if (!(f.first ?? '').trim() || !(f.last ?? '').trim()) return setErr('First and last name are required.')
    setBusy(true)
    // import lazily to avoid circular deps
    const { supabase } = await import('../../lib/api')
    const { error } = await supabase.from('patients').insert({
      full_name: `${(f.first ?? '').trim()} ${(f.last ?? '').trim()}`.trim(), birthdate: f.birthdate || null, sex: f.sex || null,
      phone: f.phone || null, email: f.email || null, emergency_contact: f.emergency_contact || null,
      medical_note: f.medical_note || null,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    onSaved()
  }

  useEscape(onClose)
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 bg-black/40 flex items-end justify-center" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()}
            className="bg-gray-50 w-full max-w-md rounded-t-2xl max-h-[92vh] overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add Patient</h2>
            <p className="text-xs text-gray-500">New patient record · EHR</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500">×</button>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-500">First name</span>
              <input value={f.first ?? ''} onChange={set('first')} required className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-500">Last name</span>
              <input value={f.last ?? ''} onChange={set('last')} required className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs font-medium text-gray-500">Birthdate</span>
              <input type="date" value={f.birthdate} onChange={set('birthdate')} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-500">Sex</span>
              <select value={f.sex} onChange={set('sex')} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white">
                <option value="">—</option><option>Female</option><option>Male</option>
              </select></label>
          </div>
          <label className="block"><span className="text-xs font-medium text-gray-500">Mobile number</span>
            <input value={f.phone} onChange={set('phone')} placeholder="+63 918 555 7712" className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-500">Email address</span>
            <input type="email" value={f.email} onChange={set('email')} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-500">Emergency contact</span>
            <input value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="Name · +63 917 555 0911" className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          <label className="block"><span className="text-xs font-medium text-gray-500">Internal notes — clinic staff only</span>
            <textarea value={f.medical_note} onChange={set('medical_note')} rows={3} placeholder="Allergies, referrals, remarks…"
                      className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label>
        </div>
        <div className="bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5 text-[11px] text-primary-800">
          The patient can register on the portal afterwards using this email to book online.
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-2.5 pb-4">
          <button type="button" onClick={onClose} className="flex-1 h-11 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold">Cancel</button>
          <button disabled={busy} className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">{busy ? 'Saving…' : 'Save Patient'}</button>
        </div>
      </form>
    </div>
  )
}
