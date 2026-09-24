import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { listMyAppointments, setAppointmentStatus, peso } from '../../lib/api'
import { fmtTime12 } from '../../lib/format'

const STATUS_PILL = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-600',
}

const STATUS_LABEL = { pending: 'Unpaid', approved: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' }
function StatusPill({ status }) {
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_PILL[status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[status] ?? status}</span>
}
const PAY_LABEL = { unpaid: 'Unpaid', verified: 'Paid ✓' }

export default function MyAppointments() {
  const { patientRecord, refresh } = useAuth()
  const [appts, setAppts] = useState(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('All')
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    if (!patientRecord?.id) return
    listMyAppointments(patientRecord.id).then(setAppts).catch((e) => setErr(e.message))
  }, [patientRecord?.id])

  const cancel = async (id) => {
    try {
      await setAppointmentStatus(id, 'cancelled')
      setAppts((a) => a.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)))
      refresh()
    } catch (ex) {
      setErr(ex.message)
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const isPast = (a) => {
    const d = a.scheduled_at ? new Date(a.scheduled_at) : new Date((a.requested_date ?? '') + 'T23:59:59')
    return ['completed', 'cancelled'].includes(a.status) || d < new Date()
  }
  const filtered = (appts ?? []).filter((a) => {
    if (tab === 'Upcoming' && (isPast(a) || !['pending', 'approved'].includes(a.status))) return false
    if (tab === 'Past' && !isPast(a)) return false
    if (q && !(a.services?.name ?? '').toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  return (
    <div className="px-4 py-4 space-y-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900">My Appointments</h1>
        <p className="text-xs text-gray-500">Reservation &amp; Scheduling</p>
      </div>

      {/* All / Upcoming / Past segmented control (Figma p35) */}
      <div className="flex bg-gray-100 rounded-lg p-1 text-sm font-medium">
        {['All', 'Upcoming', 'Past'].map((t) => (
          <button key={t} onClick={() => setTab(t)}
                  className={'flex-1 py-1.5 rounded-md ' + (tab === t ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-500')}>{t}</button>
        ))}
      </div>

      {/* search */}
      <div className="relative">
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search appointments…"
               className="w-full h-10 border border-gray-200 rounded-lg pl-9 pr-3 text-sm bg-white" />
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{(filtered ?? []).length} appointments</p>
      {err && <p className="text-xs text-red-500">{err}</p>}
      {appts?.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">No appointments yet — book one from the Book tab.</p>}
      <div className="space-y-2">
        {(filtered ?? []).map((a) => (
          <div key={a.id} className="bg-white border border-gray-200 rounded-lg px-3.5 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 text-sm font-semibold text-gray-900">{a.services?.name || 'Appointment'}</div>
              <StatusPill status={a.status} />
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {a.requested_date || (a.scheduled_at ? new Date(a.scheduled_at).toLocaleDateString() : 'Date to be assigned')}
              {a.scheduled_at ? ` · ${new Date(a.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
              {a.dentists?.full_name ? ` · ${a.dentists.full_name}` : ''}
              {` · ${peso(a.price ?? a.services?.price)}`}
            </div>

            {/* payment state */}
            {a.status === 'pending' && (
              <div className="mt-2 flex items-center gap-2">
                <span className={'text-[11px] font-bold px-2 py-0.5 rounded ' + (a.payment_status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500')}>
                  {PAY_LABEL[a.payment_status]}
                </span>
                {a.payment_status === 'unpaid' && (
                  <button onClick={() => navigate('/pay', { state: { appointment: a } })}
                          className="h-8 px-3 rounded-lg bg-primary-600 text-white text-xs font-semibold">
                    Pay now
                  </button>
                )}
                <button onClick={() => cancel(a.id)} className="ml-auto text-xs font-semibold text-red-500">Cancel booking</button>
              </div>
            )}
            {a.status === 'approved' && a.payment_status === 'verified' && (
              <span className="inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded bg-green-50 text-green-700">Paid ✓ · slot secured</span>
            )}
            {(a.status === 'completed' || (a.payment_status === 'verified' && isPast(a))) && (
              <button onClick={() => navigate('/receipt', { state: { appointment: a } })}
                      className="mt-2 h-8 px-3 rounded-lg border border-primary-200 text-primary-700 text-xs font-semibold bg-white">
                Attach receipt
              </button>
            )}
            {a.notes && <div className="text-xs text-gray-400 mt-1 italic">"{a.notes}"</div>}
          </div>
        ))}

        {/* CLINIC INFORMATION card (Figma p35) */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-400 mb-2">Clinic information</div>
          <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
            <span className="text-gray-500">Hours</span><span className="font-semibold text-gray-900">Mon - Sat · 8 AM – 5 PM</span>
          </div>
          <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
            <span className="text-gray-500">Contact</span><span className="font-semibold text-primary-700">dr.joson@dardenal.ph</span>
          </div>
        </div>
      </div>
    </div>
  )
}
