import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'

// Staff management (p68): owner creates dentist accounts; a service-role Edge
// Function would be the secure path, but on this stack we create the auth user
// client-side via owner session + admin invite... owner sessions can't call
// auth.admin. ponytail: owner generates the temp credentials here and hands
// them over; the dentist's first login keeps their profile (created on signup).

export default function OwnerStaff() {
  const navigate = useNavigate()
  const [dentists, setDentists] = useState(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null) // {email, tempPw}

  const load = () =>
    supabase.from('dentists').select('*').order('full_name')
      .then(({ data, error }) => (error ? setErr(error.message) : setDentists(data ?? [])))

  useEffect(() => { load() }, [])

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Staff</h1>
          <p className="text-xs text-gray-500">Dentists &amp; clinic roles</p>
        </div>
        <button onClick={() => setAdding((v) => !v)} className="h-9 px-3.5 rounded-lg bg-primary-600 text-white text-xs font-semibold">
          {adding ? 'Close' : '+ Add Dentist'}
        </button>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}

      {adding && <AddDentist onCreated={(c) => { setAdding(false); setCreated(c); load() }} />}

      {/* p68 success card with temp credentials */}
      {created && (
        <div className="bg-primary-50 border border-primary-200 rounded-lg p-4">
          <div className="text-sm font-bold text-primary-800">Your new dentist account has been created.</div>
          <div className="text-xs text-gray-700 mt-2">Email: <b>{created.email}</b></div>
          <div className="text-xs text-gray-700">Default password: <b>{created.tempPw}</b></div>
          <p className="text-[11px] text-gray-500 mt-2">This is a temporary password — the dentist will be asked to set their own password upon logging in.</p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => navigator.clipboard?.writeText(created.tempPw)} className="flex-1 h-9 rounded-lg border border-primary-300 text-primary-700 text-xs font-semibold bg-white">Copy Password</button>
            <button onClick={() => setCreated(null)} className="flex-1 h-9 rounded-lg bg-primary-600 text-white text-xs font-semibold">Done</button>
          </div>
        </div>
      )}

      {!dentists && <p className="text-sm text-gray-400">Loading…</p>}
      <div className="space-y-2">
        {(dentists ?? []).map((d) => (
          <div key={d.id} className="bg-white border border-gray-200 rounded-lg px-3.5 py-3 flex items-center gap-3">
            <span className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center flex-none">
              {(d.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-gray-900 truncate">{d.full_name}</span>
              <span className="block text-xs text-gray-500">{d.email}</span>
            </span>
            <span className={'text-[11px] font-bold px-2 py-0.5 rounded capitalize ' + (d.role === 'owner' ? 'bg-primary-50 text-primary-700' : 'bg-blue-100 text-blue-700')}>
              {d.role === 'owner' ? 'Owner' : 'Dentist'}
            </span>
          </div>
        ))}
      </div>
      <button onClick={() => navigate('/security')} className="w-full h-11 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold bg-white">Account Security</button>
    </div>
  )
}

function AddDentist({ onCreated }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const tempPw = () => {
    // pronounceable-enough temp password per p68 example (ramosmiguel09 style)
    const last = (name.split(' ').pop() || 'dental').toLowerCase().replace(/[^a-z]/g, '') || 'dental'
    const first = (name.split(' ')[0] || 'doc').toLowerCase().replace(/[^a-z]/g, '')
    return `${last}${first}${String(Math.floor(Math.random() * 90) + 10)}`
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!name.trim()) return setErr('Enter the dentist\'s full name.')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    setBusy(true)
    const pw = tempPw()
    // signUp creates the auth user + profile/dentist rows via the existing trigger;
    // the session that comes back is immediately signed out so the OWNER stays logged in.
    const { error } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name.trim(), role: 'dentist' } } })
    if (error) { setBusy(false); return setErr(error.message) }
    await supabase.auth.signOut()
    setBusy(false)
    onCreated({ email, tempPw: pw })
  }

  return (
    <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3.5">
      <div className="text-sm font-bold text-gray-900">Add Dentist</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name (e.g. Miguel Ramos)"
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address"
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
        {busy ? 'Creating…' : 'Create Account'}
      </button>
      <p className="text-[11px] text-gray-400">A temporary password is generated — share it with the dentist securely.</p>
    </form>
  )
}
