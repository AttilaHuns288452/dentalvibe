import { useState } from 'react'
import { signIn, signUp } from '../lib/api'

// Login / signup. Role comes from signup metadata; seeded staff accounts
// (owner@dentalvibe.ph / doctor@dentalvibe.ph) exist for testing.

export default function Login() {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState('patient')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
      } else {
        await signUp(email.trim(), password, fullName.trim(), role)
      }
      window.location.reload() // simplest way to re-run the session gate
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  const quick = async (em) => {
    setErr('')
    setBusy(true)
    try {
      await signIn(em, 'password123')
      window.location.reload()
    } catch (ex) {
      setErr(ex.message)
      setBusy(false)
    }
  }

  return (
    <div className="max-w-md mx-auto min-h-screen">
      <div className="bg-primary-600 text-white px-4 pt-10 pb-8 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-white text-primary-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold mt-3">DentalVibe</h1>
        <p className="text-xs opacity-80 mt-1">DentalVibe · Appointment &amp; Record System</p>
      </div>

      <form onSubmit={submit} className="px-4 -mt-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          <div className="flex rounded-lg bg-gray-100 p-1 text-sm font-medium">
            <button type="button" onClick={() => setMode('signin')} className={'flex-1 py-1.5 rounded-md ' + (mode === 'signin' ? 'bg-white shadow' : 'text-gray-500')}>Sign In</button>
            <button type="button" onClick={() => setMode('signup')} className={'flex-1 py-1.5 rounded-md ' + (mode === 'signup' ? 'bg-white shadow' : 'text-gray-500')}>Register</button>
          </div>

          {mode === 'signup' && (
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Full name</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} required
                     className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" />
            </label>
          )}
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Email</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                   className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" placeholder="you@email.com" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Password</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                   className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" placeholder="••••••••" />
          </label>
          {mode === 'signup' && (
            <div>
              <span className="text-xs font-medium text-gray-500">I am a</span>
              <div className="mt-1 grid grid-cols-2 gap-2 text-sm font-medium">
                {['patient', 'doctor'].map((r) => (
                  <button type="button" key={r} onClick={() => setRole(r)}
                          className={'py-2 rounded-lg border ' + (role === r ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-500')}>
                    {r === 'patient' ? 'Patient' : 'Dentist'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {err && <p className="text-xs text-red-500">{err}</p>}
          <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </div>
      </form>

      <div className="px-4 mt-4">
        <p className="text-[11px] text-center text-gray-400 uppercase tracking-wide font-semibold mb-2">Demo accounts</p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <button onClick={() => quick('owner@dentalvibe.ph')} disabled={busy} className="h-9 rounded-lg border border-gray-200 bg-white text-gray-600">Owner demo</button>
          <button onClick={() => quick('doctor@dentalvibe.ph')} disabled={busy} className="h-9 rounded-lg border border-gray-200 bg-white text-gray-600">Doctor demo</button>
        </div>
        <p className="text-[10px] text-gray-400 text-center mt-1.5">password123 · create a Patient account to test booking</p>
      </div>
    </div>
  )
}
