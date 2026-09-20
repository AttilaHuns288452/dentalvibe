import { useEffect, useState } from 'react'
import { supabase } from '../../supabaseClient'

// Staff view — dentists list with role badges. Figma frames 60–67 (simplified).

export default function OwnerStaff() {
  const [dentists, setDentists] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    supabase.from('dentists').select('*').order('full_name')
      .then(({ data, error }) => (error ? setErr(error.message) : setDentists(data ?? [])))
  }, [])

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Staff</h1>
        <p className="text-xs text-gray-500">Dentists &amp; clinic roles</p>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
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
      <p className="text-[11px] text-gray-400 text-center">New staff sign up as Dentist via Register → auto-listed here.</p>
    </div>
  )
}
