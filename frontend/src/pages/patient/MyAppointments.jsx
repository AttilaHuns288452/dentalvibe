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

function StatusPill({ status, payment }) {
  const map = { ...STATUS_PILL, submitted: 'bg-sky-100 text-sky-700', unpaid: 'bg-gray-100 text-gray-600' }
  const label = payment && status === 'pending' ? (payment === 'submitted' ? 'Verifying payment' : 'Unpaid') : status
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${map[label] ?? map.pending}`}>{label}</span>
}
const PAY_LABEL = { unpaid: 'Unpaid', submitted: 'Verifying payment', verified: 'Paid ✓' }

export default function MyAppointments() {
  const { patientRecord, refresh } = useAuth()
  const [appts, setAppts] = useState(null)
  const [err, setErr] = useState('')
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

  return (
    <div className="px-4 py-4 space-y-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900">My Appointments</h1>
        <p className="text-xs text-gray-500">Track your bookings &amp; visit history</p>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      {appts?.length === 0 && <p className="text-sm text-gray-400 py-8 text-center">No appointments yet — book one from the Book tab.</p>}
      <div className="space-y-2">
        {(appts ?? []).map((a) => (
          <div key={a.id} className="bg-white border border-gray-200 rounded-lg px-3.5 py-3">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0 text-sm font-semibold text-gray-900">{a.services?.name || 'Appointment'}</div>
              <StatusPill status={a.status} payment={a.payment_status} />
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
                <button onClick={() => cancel(a.id)} className="ml-auto text-xs font-semibold text-red-500">Cancel request</button>
              </div>
            )}
            {a.status === 'approved' && a.payment_status === 'verified' && (
              <span className="inline-block mt-2 text-[11px] font-bold px-2 py-0.5 rounded bg-green-50 text-green-700">Payment verified ✓</span>
            )}
            {a.notes && <div className="text-xs text-gray-400 mt-1 italic">"{a.notes}"</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
