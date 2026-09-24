import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase, peso } from '../../lib/api'
import { printReport } from '../../lib/format'

// Dentist Record / EHR (Figma p67/83/100): dentist card + SERVICE HISTORY
// with This week / month / year tabs + Export Service History (PDF).

const RANGE = { 'This week': 7, 'This month': 31, 'This year': 366 }
const fmt = (d) => new Date(d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

export default function DentistRecord() {
  const navigate = useNavigate()
  const dentist = useLocation().state?.dentist
  const [tab, setTab] = useState('This week')
  const [appts, setAppts] = useState([])
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!dentist?.id) return
    supabase.from('appointments')
      .select('id, price, scheduled_at, requested_date, services(name, duration_minutes), patients(full_name)')
      .eq('dentist_id', dentist.id).eq('status', 'completed')
      .order('scheduled_at', { ascending: false })
      .then(({ data, error }) => (error ? setErr(error.message) : setAppts(data ?? [])))
  }, [dentist?.id])

  if (!dentist) return (
    <div className="px-4 py-10 text-center">
      <p className="text-sm text-gray-400">No dentist selected.</p>
      <button onClick={() => navigate('/owner/staff')} className="mt-3 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Back to Staff</button>
    </div>
  )

  const cutoff = Date.now() - RANGE[tab] * 864e5
  const rows = appts.filter((a) => new Date(a.scheduled_at ?? a.requested_date).getTime() >= cutoff)
  const initials = (dentist.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')

  const toggleActive = async () => {
    const { error } = await supabase.from('dentists').update({ active: !dentist.active }).eq('id', dentist.id)
    if (!error) navigate('/owner/staff')
  }

  const exportHistory = () =>
    printReport(`Service History — ${dentist.full_name} (${tab})`, rows.map((a) =>
      `${a.services?.name ?? 'Service'} · ${fmt(a.scheduled_at ?? a.requested_date)} · ${peso(a.price ?? 0)} paid · ${a.patients?.full_name ?? ''}`))

  return (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => navigate(-1)} aria-label="Back" className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </button>

      <div>
        <h1 className="text-xl font-bold text-gray-900">Dentist Record</h1>
        <p className="text-xs text-gray-500 font-semibold text-primary-700">EHR</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <span className="w-11 h-11 rounded-full bg-primary-50 text-primary-700 text-sm font-bold flex items-center justify-center flex-none">{initials}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-gray-900 truncate">{dentist.full_name}</span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 capitalize">{dentist.role === 'owner' ? 'Owner' : 'Dentist'}</span>
          </span>
          <span className="block text-xs text-gray-500">{dentist.email}</span>
        </span>
        <button onClick={toggleActive}
                className={'text-xs font-semibold rounded-full px-3 py-1 border flex-none ' + (dentist.active === false ? 'text-primary-700 border-primary-200' : 'text-red-500 border-red-200')}>
          {dentist.active === false ? 'Restore' : 'Deactivate'}
        </button>
      </div>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Service history</h2>
        <div className="flex bg-white border border-gray-200 rounded-lg p-1 text-sm font-medium mb-2">
          {Object.keys(RANGE).map((t) => (
            <button key={t} onClick={() => setTab(t)}
                    className={'flex-1 py-1.5 rounded-md ' + (tab === t ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-500')}>{t}</button>
          ))}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {rows.length === 0 && <div className="px-3.5 py-4 text-sm text-gray-400">No completed services in this period.</div>}
          {rows.map((a) => (
            <div key={a.id} className="px-3.5 py-3">
              <div className="text-sm font-semibold text-gray-900">{a.services?.name ?? 'Service'}{a.services?.duration_minutes ? ` · ${a.services.duration_minutes} min` : ''}</div>
              <div className="text-xs text-gray-500 mt-0.5">{fmt(a.scheduled_at ?? a.requested_date)} · {peso(a.price ?? 0)} paid · {a.patients?.full_name ?? '—'}</div>
            </div>
          ))}
        </div>
      </section>

      {err && <p className="text-xs text-red-500">{err}</p>}
      <button onClick={exportHistory} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">
        Export Service History {tab} (PDF)
      </button>
    </div>
  )
}
