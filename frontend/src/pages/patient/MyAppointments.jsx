import { useEffect, useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { listMyAppointments, peso } from '../../lib/api'

const STATUS_STYLES = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-600',
}

export function StatusPill({ status }) {
  return <span className={'text-[11px] font-bold px-2 py-0.5 rounded capitalize flex-none ' + (STATUS_STYLES[status] || 'bg-gray-100 text-gray-600')}>{status}</span>
}

export default function MyAppointments() {
  const { patientRecord } = useAuth()
  const [appts, setAppts] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!patientRecord?.id) return
    listMyAppointments(patientRecord.id).then(setAppts).catch((e) => setErr(e.message))
  }, [patientRecord?.id])

  const cancel = async (id) => {
    const { setAppointmentStatus } = await import('../../lib/api')
    await setAppointmentStatus(id, 'cancelled')
    setAppts((a) => a.map((x) => (x.id === id ? { ...x, status: 'cancelled' } : x)))
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
              <StatusPill status={a.status} />
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {a.requested_date || (a.scheduled_at ? new Date(a.scheduled_at).toLocaleDateString() : 'Date to be assigned')}
              {a.dentists?.full_name ? ` · ${a.dentists.full_name}` : ''}
              {` · ${peso(a.price ?? a.services?.price)}`}
            </div>
            {a.notes && <div className="text-xs text-gray-400 mt-1 italic">"{a.notes}"</div>}
            {a.status === 'pending' && (
              <button onClick={() => cancel(a.id)} className="mt-2 text-xs font-semibold text-red-500">Cancel request</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
