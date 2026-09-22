import { useEffect, useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { supabase, peso } from '../../lib/api'

// Edit Profile (p59): patient updates contact info only; name/ID clinic-managed
export default function EditProfile({ onDone }) {
  const { patientRecord } = useAuth()
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [emg, setEmg] = useState('')
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (patientRecord) {
      setPhone(patientRecord.phone ?? '')
      setAddress(patientRecord.address ?? '')
      setEmg(patientRecord.emergency_contact ?? '')
    }
  }, [patientRecord])

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (phone && !/^[0-9+\-\s()]{7,20}$/.test(phone)) return setErr('Enter a valid phone number.')
    setBusy(true)
    const { error } = await supabase.from('patients').update({ phone, address, emergency_contact: emg }).eq('id', patientRecord.id)
    setBusy(false)
    if (error) return setErr(error.message)
    setSaved(true)
    onDone?.()
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Edit Profile</h1>
        <p className="text-xs text-gray-500">Update your patient information</p>
      </div>

      {/* identity header — read-only */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm">
          {(patientRecord?.full_name ?? '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold text-gray-900 truncate">{patientRecord?.full_name}</div>
          <div className="text-[11px] text-gray-500">Patient ID: {patientRecord?.patient_code ?? '—'}{patientRecord?.sex ? ` · ${patientRecord.sex}` : ''}{patientRecord?.age ? ` · ${patientRecord.age} y/o` : ''}</div>
        </div>
      </div>

      <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3.5">
        <h2 className="text-sm font-bold text-gray-900">Contact information</h2>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Mobile number</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+63 917 000 0000"
                 className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Home address</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, City"
                 className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-500">Emergency contact</span>
          <input value={emg} onChange={(e) => setEmg(e.target.value)} placeholder="Name · +63 918 000 0000"
                 className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
        </label>
        <p className="text-[11px] text-gray-400">Name, birthdate, and Patient ID are clinic-managed — ask the front desk to update them.</p>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-2.5">
          <button type="button" onClick={() => history.back()} className="flex-1 h-11 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold bg-white">Cancel</button>
          <button disabled={busy} className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
          </button>
        </div>
      </form>

      <div className="bg-gray-50 border border-gray-100 rounded-lg p-3.5 text-[11px] text-gray-500">
        <b className="text-gray-700">Clinical records are confidential.</b> Treatment notes and attachments are managed by your dentist and are not shown on the patient portal. You may ask for your records in messages.
      </div>
    </div>
  )
}
