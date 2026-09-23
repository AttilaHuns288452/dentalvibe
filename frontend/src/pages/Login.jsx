import { useState } from 'react'
import { signIn, signUp } from '../lib/api'
import { useAuth } from '../context/RoleContext'

// Login / register. Staff accounts are provisioned by the clinic (no public
// staff signup); patients self-register. No demo buttons in production.

export default function Login() {
  const { refresh } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
        window.location.href = '/' // full reload — hydrate runs from persisted session
      } else {
        await signUp(email.trim(), password, fullName.trim(), 'patient')
        setOk('Account created! You can now sign in.')
        setMode('signin')
        setBusy(false)
        return
      }
    } catch (ex) {
      setErr(ex.message)
      setBusy(false)
    }
  }

  return (
    // centered vertically, respects device safe areas
    <div className="max-w-md mx-auto min-h-screen bg-gray-50 flex flex-col justify-center px-4 py-[max(1.5rem,env(safe-area-inset-top))]">
      <div className="bg-primary-600 text-white rounded-2xl pt-8 pb-7 px-4 text-center shadow-sm">
        <div className="w-16 h-16 mx-auto rounded-full bg-white text-primary-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold mt-3">D.A.R. Dental Clinic</h1>
        <p className="text-xs opacity-80 mt-1">Appointment &amp; Record System</p>
      </div>

      <form onSubmit={submit} className="mt-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 shadow-sm">
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

          {err && <p className="text-xs text-red-500">{err}</p>}
          {ok && <p className="text-xs text-green-600">{ok}</p>}
          <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Patient Account'}
          </button>
          {mode === 'signin' && (
            <a href="#/reset" className="block text-center text-xs font-semibold text-primary-700">Forgot password?</a>
          )}
        </div>
      </form>

      <p className="mt-4 text-[11px] text-gray-400 text-center">
        Patient self-registration only. Staff accounts are provisioned by the clinic owner.
      </p>
    </div>
  )
}
