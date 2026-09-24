import { useState } from 'react'
import { signIn, signUp } from '../lib/api'
import { useAuth } from '../context/RoleContext'

// Login (p31) + 3-step registration wizard (p32/70/73) → Account Activated (p55).
// Staff accounts are provisioned by the clinic owner. Password rules per p80.

const STEPS = ['Your Details', 'Emergency contact', 'Email & Password']

export default function Login() {
  const { refresh } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      window.location.href = '/' // full reload — hydrate runs from persisted session
    } catch (ex) {
      setErr(ex.message)
      setBusy(false)
    }
  }

  return (
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

      {mode === 'signin' ? (
        <form onSubmit={submit} className="mt-4">
          <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 shadow-sm">
            <div className="flex rounded-lg bg-gray-100 p-1 text-sm font-medium">
              <button type="button" onClick={() => setMode('signin')} className="flex-1 py-1.5 rounded-md bg-white shadow">Sign In</button>
              <button type="button" onClick={() => setMode('signup')} className="flex-1 py-1.5 rounded-md text-gray-500">Register</button>
            </div>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Email address</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                     className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" placeholder="you@email.com" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
                     className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" placeholder="••••••••" />
            </label>
            {err && <p className="text-xs text-red-500">{err}</p>}
            <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Please wait…' : 'Sign In'}
            </button>
            <a href="#/reset" className="block text-center text-xs font-semibold text-primary-700">Forgot password?</a>
          </div>
        </form>
      ) : (
        <RegisterWizard onDone={refresh} onSwitch={() => setMode('signin')} />
      )}

      <div className="mt-4 bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5 text-[11px] text-primary-800 flex items-center justify-center gap-1.5">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        Clinic hours: Mon – Sat · 8:00 AM – 5:00 PM
      </div>
    </div>
  )
}

// 3-step registration (p32/70/73) → Account Activated (p55)
function RegisterWizard({ onDone, onSwitch }) {
  const [step, setStep] = useState(1)
  const [f, setF] = useState({ first: '', last: '', address: '', birthdate: '', sex: '', medical_note: '', emergency_contact: '', phone: '', email: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }))

  const pwRules = {
    len: f.password.length >= 8,
    num: /\d/.test(f.password),
    case: /[a-z]/.test(f.password) && /[A-Z]/.test(f.password),
  }

  const next = () => {
    setErr('')
    if (step === 1) {
      if (!f.first.trim() || !f.last.trim()) return setErr('First and last name are required.')
      if (!f.birthdate) return setErr('Birthdate is required.')
    }
    if (step === 2 && !f.emergency_contact.trim()) return setErr('Emergency contact is required.')
    setStep((s) => Math.min(3, s + 1))
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!(pwRules.len && pwRules.num && pwRules.case)) return setErr('Password must meet all requirements.')
    setBusy(true)
    try {
      await signUp(f.email.trim(), f.password, `${f.first.trim()} ${f.last.trim()}`.trim(), 'patient', {
        phone: f.phone || undefined, birthdate: f.birthdate || undefined, sex: f.sex || undefined,
        address: f.address || undefined, emergency_contact: f.emergency_contact || undefined,
        medical_note: f.medical_note || undefined,
      })
      setDone(true)
    } catch (ex) {
      setErr(ex.message)
    }
    setBusy(false)
  }

  if (done) {
    return (
      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-6 text-center shadow-sm">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </div>
        <h2 className="text-lg font-bold text-gray-900 mt-3">Account Activated</h2>
        <p className="text-xs text-gray-500 mt-1">Welcome to the clinics family!<br />You may now book your appointment.</p>
        <button onClick={() => window.location.reload()} className="w-full h-11 mt-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Go to my dashboard</button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      {/* progress (p32) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
        <h2 className="text-sm font-bold text-gray-900 text-center mb-3">Create your account</h2>
        <div className="flex items-center justify-center gap-1.5">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ' + (step === i + 1 ? 'bg-primary-700 text-white' : 'bg-primary-100 text-primary-700')}>{i + 1}</div>
              <span className={'text-[11px] ' + (step === i + 1 ? 'font-bold text-gray-900' : 'text-gray-400')}>{label}</span>
              {i < 2 && <span className="w-4 border-t border-dashed border-gray-300" />}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3 shadow-sm">
        {step === 1 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-xs font-medium text-gray-500">First name</span>
                <input value={f.first} onChange={set('first')} required className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
              <label className="block"><span className="text-xs font-medium text-gray-500">Last name</span>
                <input value={f.last} onChange={set('last')} required className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            </div>
            <label className="block"><span className="text-xs font-medium text-gray-500">Home address</span>
              <input value={f.address} onChange={set('address')} className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className="text-xs font-medium text-gray-500">Birthdate</span>
                <input type="date" value={f.birthdate} onChange={set('birthdate')} required className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
              <div><span className="text-xs font-medium text-gray-500">Sex</span>
                <div className="flex gap-2 mt-1">
                  {['Male', 'Female'].map((sx) => (
                    <button key={sx} type="button" onClick={() => setF((v) => ({ ...v, sex: sx }))}
                            className={'flex-1 h-11 rounded-lg border text-sm font-semibold ' + (f.sex === sx ? 'bg-primary-50 text-primary-700 border-primary-300' : 'bg-white text-gray-600 border-gray-200')}>{sx}</button>
                  ))}
                </div>
              </div>
            </div>
            <label className="block"><span className="text-xs font-medium text-gray-500">Medical Note</span>
              <textarea value={f.medical_note} onChange={set('medical_note')} rows={2} placeholder="Alergies in…"
                        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></label>
          </>
        )}
        {step === 2 && (
          <>
            <label className="block"><span className="text-xs font-medium text-gray-500">Emergency contact</span>
              <input value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="Name · +63 917 555 0000" required
                     className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-500">Contact number</span>
              <input value={f.phone} onChange={set('phone')} placeholder="+63 900 000 0000"
                     className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
          </>
        )}
        {step === 3 && (
          <>
            <label className="block"><span className="text-xs font-medium text-gray-500">Email address</span>
              <input type="email" value={f.email} onChange={set('email')} required className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            <label className="block"><span className="text-xs font-medium text-gray-500">Password</span>
              <input type="password" value={f.password} onChange={set('password')} required className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm" /></label>
            {/* p80 password rules */}
            <ul className="text-[11px] space-y-1">
              <li className={pwRules.len ? 'text-green-600' : 'text-gray-400'}>{pwRules.len ? '✓' : '·'} Password must be at least 8 characters</li>
              <li className={pwRules.num ? 'text-green-600' : 'text-gray-400'}>{pwRules.num ? '✓' : '·'} Password must contain 1 number</li>
              <li className={pwRules.case ? 'text-green-600' : 'text-gray-400'}>{pwRules.case ? '✓' : '·'} Password must contain 1 uppercase and 1 lowercase</li>
            </ul>
          </>
        )}
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-2.5">
          {step > 1 && (
            <button type="button" onClick={() => setStep((s) => s - 1)} className="flex-1 h-11 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold">‹ Back</button>
          )}
          {step < 3 ? (
            <button type="button" onClick={next} className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">Next</button>
          ) : (
            <button disabled={busy} className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
              {busy ? 'Creating…' : 'Create Account'}
            </button>
          )}
        </div>
      </div>

      <p className="text-center text-xs text-gray-500">
        Already have an account?{' '}
        <button type="button" onClick={onSwitch} className="font-semibold text-primary-700">Log in</button>
      </p>
    </form>
  )
}
