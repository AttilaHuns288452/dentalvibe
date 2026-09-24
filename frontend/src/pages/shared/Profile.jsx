import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { listMyAppointments } from '../../lib/api'
import { signOut } from '../../lib/api'

export default function Profile() {
  const { session, profile, patientRecord, logout } = useAuth()
  const navigate = useNavigate()
  const [visits, setVisits] = useState([])
  useEffect(() => {
    if (patientRecord?.id) listMyAppointments(patientRecord.id)
      .then((a) => setVisits((a ?? []).filter((x) => x.status === 'completed'))).catch(() => {})
  }, [patientRecord?.id])
  const [phone, setPhone] = useState(patientRecord?.phone || '')
  const [address, setAddress] = useState(patientRecord?.address || '')
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [editing, setEditing] = useState(false)

  const save = async () => {
    setErr('')
    try {
      const { supabase } = await import('../../supabaseClient')
      const { error } = await supabase
        .from('patients')
        .update({ phone: phone.trim(), address: address.trim() })
        .eq('id', patientRecord.id)
      if (error) throw error
      setSaved(true)
      setEditing(false)
      setTimeout(() => setSaved(false), 2000)
    } catch (ex) {
      setErr(ex.message)
    }
  }

  const rows = [
    ['Birthdate', patientRecord?.birthdate ? new Date(patientRecord.birthdate).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'],
    ['Mobile', patientRecord?.phone || '—'],
    ['Emergency contact', patientRecord?.emergency_contact || '—'],
    ['Email', session.user.email],
  ]

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Profile</h1>
        <p className="text-xs text-gray-500">Account information</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-primary-50 text-primary-700 font-bold flex items-center justify-center text-lg flex-none">
          {(profile.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-900">{profile.full_name}</div>
          <div className="text-xs text-gray-500">{session.user.email}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between px-3.5 py-2.5 text-sm">
            <span className="text-gray-500">{k}</span>
            <span className="font-medium text-gray-900">{v}</span>
          </div>
        ))}
      </div>

      {/* contact details — patient-editable */}
      <section>
        <div className="flex items-center justify-between mb-1.5">
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Contact details</h2>
          {!editing && (
            <button onClick={() => setEditing(true)} className="text-xs font-semibold text-primary-700">Edit</button>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Mobile number</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editing}
                   placeholder="+63 9xx xxx xxxx"
                   className={'mt-1 w-full h-11 border rounded-lg px-3 text-sm ' + (editing ? 'border-gray-200' : 'border-transparent bg-gray-50 text-gray-500')} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Home address</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!editing}
                   className={'mt-1 w-full h-11 border rounded-lg px-3 text-sm ' + (editing ? 'border-gray-200' : 'border-transparent bg-gray-50 text-gray-500')} />
          </label>
          {editing && (
            <div className="flex gap-2">
              <button onClick={save} className="flex-1 h-10 rounded-lg bg-primary-600 text-white text-sm font-semibold">Save</button>
              <button onClick={() => { setEditing(false); setPhone(patientRecord?.phone || ''); setAddress(patientRecord?.address || '') }}
                      className="flex-1 h-10 rounded-lg border border-gray-200 text-sm text-gray-500">Cancel</button>
            </div>
          )}
          {saved && <p className="text-xs text-green-600">Saved ✓</p>}
          {err && <p className="text-xs text-red-500">{err}</p>}
        </div>
      </section>

      {/* confidentiality notice (p38) */}
      <div className="bg-white border border-gray-200 rounded-lg p-3.5 flex gap-2.5">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-primary-600 flex-none mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
        <div>
          <div className="text-sm font-semibold text-gray-900">Clinical records are confidential</div>
          <p className="text-[11px] text-gray-500 mt-0.5">Treatment notes and attachments are managed by your dentist and are not shown on the patient portal. You may ask for your records in message.</p>
        </div>
      </div>

      {/* visit history (p38) */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Visit history</h2>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {visits.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-400">No completed visits yet.</div>}
          {visits.map((v) => (
            <div key={v.id} className="px-3.5 py-2.5">
              <div className="text-sm font-semibold text-gray-900">{v.services?.name ?? 'Service'}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {new Date(v.scheduled_at ?? v.requested_date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                {v.scheduled_at ? ` · ${new Date(v.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''} · ₱{Number(v.price ?? 0).toLocaleString()} paid
              </div>
            </div>
          ))}
        </div>
      </section>

      <button
        onClick={() => navigate('/security')}
        className="w-full h-11 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold bg-white">
        Account Security
      </button>
      <button
        onClick={logout}
        className="w-full h-11 rounded-lg border border-red-200 text-red-500 text-sm font-semibold bg-white">
        Log Out
      </button>
    </div>
  )
}
