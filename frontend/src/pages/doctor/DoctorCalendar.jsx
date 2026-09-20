import { useEffect, useState } from 'react'
import { listAppointments } from '../../lib/api'

// Day view: appointment blocks under time slots (Figma frame 29).

export default function DoctorCalendar() {
  const [appts, setAppts] = useState(null)
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10))
  const [err, setErr] = useState('')

  useEffect(() => {
    listAppointments().then(setAppts).catch((e) => setErr(e.message))
  }, [])

  const dayAppts = (appts ?? []).filter((a) => {
    const d = (a.scheduled_at || a.requested_date || '').slice(0, 10)
    return d === day && a.status !== 'cancelled'
  })
  dayAppts.sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
        <p className="text-xs text-gray-500">Color-coded by appointment status</p>
      </div>

      <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
             className="w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />

      {err && <p className="text-xs text-red-500">{err}</p>}
      {!appts && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="space-y-2">
        {dayAppts.length === 0 && appts && (
          <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-3 text-sm text-gray-400">No appointments this day.</div>
        )}
        {dayAppts.map((a) => (
          <div key={a.id} className={'bg-white border border-gray-200 rounded-lg px-3.5 py-3 border-l-4 ' +
            (a.status === 'approved' ? 'border-l-green-500' : a.status === 'completed' ? 'border-l-blue-500' : 'border-l-amber-500')}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-900">{a.scheduled_at ? new Date(a.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Time TBA'}</span>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded capitalize bg-gray-100 text-gray-600">{a.status}</span>
            </div>
            <div className="text-sm font-semibold text-gray-900 mt-0.5">{a.patients?.full_name}</div>
            <div className="text-xs text-gray-500">{a.services?.name}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
