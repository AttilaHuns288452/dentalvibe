import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'
import { useAuth } from '../../context/RoleContext'

// Staff (Figma p44/68): count label, ADD NEW DENTIST card, CLINIC TEAM rows
// (Owner badge + You badge + email + chevron), DEACTIVATED section w/ Remove.
// Temp-password creation per p68.

export default function OwnerStaff() {
  const { profile } = useAuth()
  const [dentists, setDentists] = useState(null)
  const [err, setErr] = useState('')
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState(null)

  const load = () =>
    supabase.from('dentists').select('*').order('full_name')
      .then(({ data, error }) => (error ? setErr(error.message) : setDentists(data ?? [])))

  useEffect(() => { load() }, [])

  const active = (dentists ?? []).filter((d) => d.active !== false)
  const deactivated = (dentists ?? []).filter((d) => d.active === false)

  const removeDentist = async (d) => {
    // full removal of a never-onboarded record; deactivation is the softer path
    const { error } = await supabase.from('dentists').delete().eq('id', d.id)
    if (error) {
      // record has history — just deactivate
      await supabase.from('dentists').update({ active: false }).eq('id', d.id)
    }
    load()
  }

  const reactivate = async (d) => {
    await supabase.from('dentists').update({ active: true }).eq('id', d.id)
    load()
  }

  const Row = ({ d }) => (
    <div className="flex items-center gap-3 px-3.5 py-3">
      <span className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center flex-none">
        {(d.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-semibold text-gray-900 truncate">{d.full_name}</span>
          <span className={'text-[11px] font-bold px-2 py-0.5 rounded-full ' + (d.role === 'owner' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700')}>
            {d.role === 'owner' ? 'Owner' : 'Dentist'}
          </span>
          {profile?.full_name === d.full_name && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-gray-200 text-gray-500">You</span>
          )}
        </span>
        <span className="block text-xs text-gray-500 mt-0.5">{d.email}</span>
      </span>
      <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
    </div>
  )

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Staff</h1>
          <p className="text-xs text-gray-500">Dentists &amp; clinic roles</p>
        </div>
        <span className="text-xs text-gray-400">{active.length} members</span>
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

      {/* ADD NEW DENTIST card (p44) */}
      <button onClick={() => setAdding(true)} className="w-full bg-white border border-gray-200 rounded-lg p-3.5 flex items-center gap-3 text-left">
        <span className="w-11 h-11 rounded-lg bg-gray-100 flex items-center justify-center flex-none">
          <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-gray-900 uppercase tracking-wide">Add New Dentist</span>
          <span className="block text-xs text-gray-500">Create a new dentist account</span>
        </span>
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
      </button>

      {!dentists && <p className="text-sm text-gray-400">Loading…</p>}

      {active.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Clinic team</h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {active.map((d) => <Row key={d.id} d={d} />)}
          </div>
        </section>
      )}

      {deactivated.length > 0 && (
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Deactivated</h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {deactivated.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-3.5 py-3">
                <span className="w-10 h-10 rounded-full bg-gray-100 text-gray-500 text-xs font-bold flex items-center justify-center flex-none">
                  {(d.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-gray-500 truncate">{d.full_name}</span>
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">Dentist</span>
                  </span>
                  <span className="block text-xs text-gray-400 mt-0.5">Deactivated · {d.email}</span>
                </span>
                <button onClick={() => reactivate(d)} className="text-xs font-semibold text-primary-700 border border-primary-200 rounded-full px-3 py-1 flex-none">Restore</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function AddDentist({ onCreated }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const tempPw = () => {
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
    const { error } = await supabase.auth.signUp({ email, password: pw, options: { data: { full_name: name.trim(), role: 'doctor' } } })
    if (error) { setBusy(false); return setErr(error.message) }
    await supabase.auth.signOut()
    setBusy(false)
    onCreated({ email, tempPw: pw })
  }

  return (
    <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3.5">
      <div className="text-sm font-bold text-gray-900">Add Dentist</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name (e.g. Miguel Ramos)"
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" />
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email address"
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
        {busy ? 'Creating…' : 'Create Account'}
      </button>
      <p className="text-[11px] text-gray-400">A temporary password is generated — share it with the dentist securely.</p>
    </form>
  )
}
