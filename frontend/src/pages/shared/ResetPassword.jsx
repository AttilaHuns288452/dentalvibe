import { useEffect, useState } from 'react'
import { supabase, getClinicSettings } from '../../lib/api'
import { fmtTime12, fmtDays } from '../../lib/format'

// Reset Password (p53): email → reset link. Supabase sends the email; user
// returns via the link which lands them on /reset-confirm with the recovery session.
export default function ResetPassword() {
  const [clinic, setClinic] = useState(null)
  useEffect(() => { getClinicSettings().then(setClinic).catch(() => {}); }, [])
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setErr('Enter a valid email address.')
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/reset-confirm', // routed path — hash routes are gone
    })
    setBusy(false)
    if (error) return setErr(error.message)
    setSent(true)
  }

  return (
    <div className="px-4 py-8 max-w-md mx-auto">
      {!sent ? (
        <form onSubmit={submit} className="space-y-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reset Password</h1>
            <p className="text-xs text-gray-500 mt-1">Enter your registered email address and we will send you a reset link.</p>
          </div>
          <label className="block">
            <span className="text-xs font-medium text-gray-500">Email address</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
          </label>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Sending…' : 'Send Reset Link'}
          </button>
          <p className="text-[11px] text-gray-500 text-center">Tip: reset links expire in 15 minutes — request a new one anytime if it lapses.</p>
        </form>
      ) : (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18v12H3zM3 7l9 6 9-6" /></svg>
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-3">Check your inbox</h1>
          <p className="text-xs text-gray-500 mt-1">Click the reset link we sent to <b>{email}</b> to set a new password.</p>
        </div>
      )}
      <div className="mt-8 bg-white border border-gray-200 rounded-lg p-3.5 text-xs text-gray-600 space-y-1">
        <div className="font-semibold text-gray-900">Still need help?</div>
        <div>Clinic email · {clinic?.clinic_email ?? ''}</div>
        <div>Hours · {fmtDays(clinic?.open_days)} · {clinic ? fmtTime12(clinic.open_time) + ' – ' + fmtTime12(clinic.close_time) : 'Clinic hours unavailable'}</div>
      </div>
      <a href="/" className="block text-center text-xs font-semibold text-primary-700 mt-4">Back to Sign In</a>
    </div>
  )
}

// second half of the flow: the new-password form (opens from the email link)
export function ResetConfirm() {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const rules = {
    len: pw.length >= 8,
    num: /\d/.test(pw),
    case: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
  }
  const match = pw2.length > 0 && pw === pw2

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!(rules.len && rules.num && rules.case)) return setErr('Password does not meet the requirements.')
    if (!match) return setErr('Passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr(error.message)
    setDone(true)
  }

  if (done) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-3">Password updated</h1>
        <p className="text-xs text-gray-500 mt-1">You'll be signed in with the new password next time.</p>
        <a href="/" className="inline-block mt-4 h-10 px-6 leading-10 rounded-lg bg-primary-600 text-white text-sm font-semibold">Back to Sign In</a>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="px-4 py-8 max-w-md mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Set a new password</h1>
        <p className="text-xs text-gray-500 mt-1">Choose a strong password for your account.</p>
      </div>
      <input type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)}
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      <ul className="text-[11px] space-y-1">
        <li className={rules.len ? 'text-green-600' : 'text-gray-500'}>Password must be at least 8 characters</li>
        <li className={rules.num ? 'text-green-600' : 'text-gray-500'}>Password must contain 1 number</li>
        <li className={rules.case ? 'text-green-600' : 'text-gray-500'}>Password must contain 1 uppercase and 1 lowercase</li>
      </ul>
      <input type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)}
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
      {pw2 && <p className={'text-[11px] ' + (match ? 'text-green-600' : 'text-red-500')}>{match ? '✓ Password match' : 'Passwords do not match'}</p>}
      {err && <p className="text-xs text-red-500">{err}</p>}
      <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
        {busy ? 'Updating…' : 'Update password'}
      </button>
    </form>
  )
}
