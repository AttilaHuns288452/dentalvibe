import { useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { signOut } from '../../lib/api'

export default function Profile() {
  const { session, profile, patientRecord, logout } = useAuth()
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
    ['Full name', profile.full_name],
    ['Email', session.user.email],
    ['Patient ID', patientRecord ? `PAT-${patientRecord.id.slice(0, 8).toUpperCase()}` : '—'],
    ['Role', 'Patient'],
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

      <button
        onClick={logout}
        className="w-full h-11 rounded-lg border border-red-200 text-red-500 text-sm font-semibold bg-white">
        Log Out
      </button>
    </div>
  )
}
