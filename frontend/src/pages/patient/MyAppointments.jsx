import { useEffect, useState } from 'react'
import Skel from '../../components/Skel'
import { useStickyState , useRevalidateOnVisible } from '../../lib/hooks'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { listMyAppointments, setAppointmentStatus, peso, getClinicSettings } from '../../lib/api'
import { fmtTime12, fmtDays } from '../../lib/format'

const STATUS_PILL = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-600',
}

const STATUS_LABEL = { pending: 'Unpaid', approved: 'Confirmed', completed: 'Completed', cancelled: 'Cancelled' }
function StatusPill({ status }) {
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_PILL[status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[status] ?? status}</span>
}
const PAY_LABEL = { unpaid: 'Payment required', pending: 'Payment pending', paid: 'Paid ✓' }
const PAY_PILL = { unpaid: 'bg-gray-100 text-gray-500', pending: 'bg-amber-100 text-amber-700', paid: 'bg-green-100 text-green-700' }

export default function MyAppointments() {
  const location = useLocation()
  const focusAppt = new URLSearchParams(location.search).get('appt') // deep link from a notification
  useEffect(() => {
    if (!focusAppt) return
    const t = setTimeout(() => {
      const el = document.getElementById('appt-' + focusAppt)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 400)
    return () => clearTimeout(t)
  }, [focusAppt])
  const [clinic, setClinic] = useState(null)
  useEffect(() => { getClinicSettings().then(setClinic).catch(() => {}); }, [])
  const { patientRecord, refresh } = useAuth()
  const [appts, setAppts] = useState(null)
  const [err, setErr] = useState('')
  const [tab, setTab] = useStickyState('dv_appt_tab', 'All') // survives detail -> Back (#52)
  const [openId, setOpenId] = useState(null)
  const [q, setQ] = useStickyState('dv_appt_q', '')
  const navigate = useNavigate()

  const load = async () => {
    if (!patientRecord?.id) return
    listMyAppointments(patientRecord.id).then(setAppts).catch((e) => setErr(e.message))
  }
  useEffect(() => { load() }, [patientRecord?.id])
  useRevalidateOnVisible(load)

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
    if (tab === 'Past' && (!isPast(a) || a.status === 'pending')) return false // lapsed unbooked != history (fidelity 3e)
    if (q && !(a.services?.name ?? '').toLowerCase().includes(q.toLowerCase())) return false
    return true
  })

  if (appts === null && !err) return <div className="px-4 py-4"><Skel lines={3} h="h-16" /></div>
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
                  className={'flex-1 min-h-[44px] rounded-md ' + (tab === t ? 'bg-primary-50 text-primary-700 font-semibold' : 'text-gray-500')}>{t}</button>
        ))}
      </div>

      {/* search */}
      <div className="relative">
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search appointments…"
               className="w-full h-10 border border-gray-200 rounded-lg pl-9 pr-3 text-sm bg-white" />
      </div>

      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{(filtered ?? []).length} appointments</p>
      {err && <p className="text-xs text-red-500">{err}</p>}
      {appts?.length === 0 && <p className="text-sm text-gray-500 py-8 text-center">No appointments yet — book one from the Book tab.</p>}
      <div className="space-y-2">
        {(filtered ?? []).map((a) => (
          <div key={a.id} id={'appt-' + a.id} className={'bg-white border rounded-lg px-3.5 py-3 ' + (a.id === focusAppt ? 'border-primary-400 ring-2 ring-primary-200' : 'border-gray-200')}>
            <button type="button" onClick={() => setOpenId(openId === a.id ? null : a.id)} className="min-h-[44px] w-full flex items-center gap-2 text-left">
              <div className="flex-1 min-w-0 text-sm font-semibold text-gray-900">{a.services?.name || 'Appointment'}</div>
              <StatusPill status={a.status} />
              <svg viewBox="0 0 24 24" className={'w-4 h-4 text-gray-500 flex-none transition-transform ' + (openId === a.id ? 'rotate-90' : '')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
            </button>
            {openId === a.id && (
              <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-600 space-y-1">
                <div className="flex justify-between"><span className="text-gray-500">Reference</span><span className="font-semibold">{a.id.slice(0, 8).toUpperCase()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Service fee</span><span className="font-semibold">{peso(a.price ?? a.services?.price)}</span></div>
                {a.notes && <div className="italic text-gray-500">"{a.notes}"</div>}
              </div>
            )}
            <div className="text-xs text-gray-500 mt-1">
              {a.requested_date || (a.scheduled_at ? new Date(a.scheduled_at).toLocaleDateString() : 'Date to be assigned')}
              {a.scheduled_at ? ` · ${new Date(a.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}
              {a.dentists?.full_name ? ` · ${a.dentists.full_name}` : ''}
              {` · ${peso(a.price ?? a.services?.price)}`}
            </div>

            {/* payment state */}
            {a.status === 'pending' && (
              <div className="mt-2 flex items-center gap-2">
                <span className={'text-[11px] font-bold px-2 py-0.5 rounded ' + (PAY_PILL[a.payment_status] ?? 'bg-gray-100 text-gray-500')}>
                  {PAY_LABEL[a.payment_status] ?? a.payment_status}
                </span>
                {(a.payment_status === 'unpaid' || a.payment_status === 'pending') && (
                  <button onClick={() => navigate('/pay/qr?appt=' + a.id, { state: { appointment: a } })}
                          className="h-11 px-3 rounded-lg bg-primary-600 text-white text-xs font-semibold">
                    {a.payment_status === 'pending' ? 'View payment' : 'Pay now'}
                  </button>
                )}
                <button onClick={() => cancel(a.id)} className="ml-auto min-h-[44px] px-2 text-xs font-semibold text-red-500">Cancel booking</button>
              </div>
            )}
            {a.status === 'approved' && a.payment_status === 'paid' && (
              <span className="inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded bg-green-50 text-green-700">Paid ✓ · slot secured</span>
            )}
          </div>
        ))}

        {/* CLINIC INFORMATION card (Figma p35) */}
        <div className="bg-white border border-gray-200 rounded-lg p-4 mt-4">
          <div className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-2">Clinic information</div>
          <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
            <span className="text-gray-500">Hours</span><span className="font-semibold text-gray-900">{fmtDays(clinic?.open_days)} · {clinic ? fmtTime12(clinic.open_time) + ' – ' + fmtTime12(clinic.close_time) : '10 AM – 5 PM'}</span>
          </div>
          <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
            <span className="text-gray-500">Contact</span><span className="font-semibold text-primary-700">{clinic?.clinic_email ?? ''}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
