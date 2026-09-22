import { useState } from 'react'
import { supabase } from '../../lib/api'

// Account Security (p80/96): change password with live rule checks
export default function AccountSecurity() {
  const [cur, setCur] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const rules = { len: pw.length >= 8, num: /\d/.test(pw), case: /[a-z]/.test(pw) && /[A-Z]/.test(pw) }
  const match = pw2.length > 0 && pw === pw2
  const allOk = rules.len && rules.num && rules.case && match

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!allOk) return setErr('Password does not meet the requirements.')
    setBusy(true)
    // verify current password first (trust boundary), then update
    const { error: vErr } = await supabase.auth.signInWithPassword({
      email: (await supabase.auth.getUser()).data.user.email, password: cur,
    })
    if (vErr) { setBusy(false); return setErr('Current password is incorrect.') }
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setErr(error.message)
    setOk(true)
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div className="text-center py-2">
        <div className="w-14 h-14 mx-auto rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3 8-8 10-5-2-8-5.5-8-10V6z" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-2">Account Security</h1>
        <p className="text-xs text-gray-500 mt-1 px-6">Spot something suspicious? Be sure to change your password immediately to keep your account safe.</p>
      </div>

      {ok ? (
        <div className="bg-white border border-gray-200 rounded-lg p-4 text-center">
          <div className="text-sm font-semibold text-green-600">Password updated</div>
          <p className="text-xs text-gray-500 mt-1">You'll be signed in with the new password next time.</p>
        </div>
      ) : (
        <form onSubmit={submit} className="bg-white border border-gray-200 rounded-lg p-4 space-y-3.5">
          <h2 className="text-sm font-bold text-gray-900">Change Password</h2>
          <input type="password" placeholder="Current password" value={cur} onChange={(e) => setCur(e.target.value)}
                 className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
          <input type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)}
                 className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
          <ul className="text-[11px] space-y-1">
            <li className={rules.len ? 'text-green-600' : 'text-gray-400'}>{rules.len ? '✓' : '·'} Password must be at least 8 characters</li>
            <li className={rules.num ? 'text-green-600' : 'text-gray-400'}>{rules.num ? '✓' : '·'} Password must contain 1 number</li>
            <li className={rules.case ? 'text-green-600' : 'text-gray-400'}>{rules.case ? '✓' : '·'} Password must contain 1 uppercase and 1 lowercase</li>
          </ul>
          <input type="password" placeholder="Confirm password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                 className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
          {pw2 && <p className={'text-[11px] ' + (match ? 'text-green-600' : 'text-red-500')}>{match ? '✓ Password match' : 'Passwords do not match'}</p>}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}
    </div>
  )
}
