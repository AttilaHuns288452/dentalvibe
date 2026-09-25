import { useState } from 'react'
import { supabase } from '../lib/api'
import { isDev, DEV_ACCOUNTS, DEV_PW, devLogout, DEV_TOOLS } from '../lib/dev'

// Dev QA panel — one-tap role switching. Compiled out unless VITE_ENABLE_DEV_TOOLS=1.
export default function DevPanel() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  if (!DEV_TOOLS || !isDev()) return null

  const loginAs = async (acc) => {
    setBusy(acc.role)
    await supabase.auth.signOut().catch(() => {})
    const { error } = await supabase.auth.signInWithPassword({ email: acc.email, password: DEV_PW })
    if (error) { setBusy(''); alert(error.message); return }
    window.location.href = '/' // full reload — hydrate runs from persisted session
  }

  return (
    <div className="fixed left-3 z-[60] bottom-[calc(8.5rem+env(safe-area-inset-bottom))] md:bottom-4 md:left-[76px] lg:left-[244px] opacity-80">
      {open && (
        <div className="mb-2 bg-gray-900 text-white rounded-xl p-2 w-56 shadow-xl text-xs space-y-1">
          <div className="px-1 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-500">Dev login</div>
          {DEV_ACCOUNTS.map((acc) => (
            <button key={acc.role} onClick={() => loginAs(acc)} disabled={!!busy}
                    className="w-full text-left px-2.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 disabled:opacity-50">
              {busy === acc.role ? 'Signing in…' : acc.label}
            </button>
          ))}
          <div className="px-1 pt-1 text-[10px] text-gray-500">pw: {DEV_PW}</div>
          <button onClick={() => { devLogout(); location.reload() }}
                  className="w-full text-left px-2.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-500">
            Hide dev tools
          </button>
        </div>
      )}
      <button onClick={() => setOpen(!open)} aria-label="Dev tools"
              className="w-10 h-10 rounded-full bg-gray-900 text-white text-xs font-bold shadow-lg">
        {open ? '×' : 'DEV'}
      </button>
    </div>
  )
}
