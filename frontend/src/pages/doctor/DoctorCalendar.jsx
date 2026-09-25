import Skel from '../../components/Skel'
import { useRevalidateOnVisible } from '../../lib/hooks'
import { useEffect, useState } from 'react'
import { listAppointments, setAppointmentStatus, getClinicSettings } from '../../lib/api'
import { fmtTime12 } from '../../lib/format'

// Calendar Day view — Figma frame 29: Day/Week/Month seg control, formatted date
// heading, hour rows with color-coded appointment blocks (time · name · service).

const STATUS_PILL = {
  approved: 'bg-green-100 text-green-700 border-l-green-500',
  completed: 'bg-blue-100 text-blue-700 border-l-blue-500',
  pending: 'bg-amber-100 text-amber-700 border-l-amber-500',
  cancelled: 'bg-red-100 text-red-600 border-l-red-500',
}

// hour slots from settings, fallback 10AM–5PM
// ponytail: date keys slice the ISO string; safe because all slots are 10:00–16:30 (UTC date == local date).
// If evening slots are ever added, switch every day-key to a local-date formatter.
function hoursFor(open, close) {
  const [oh] = (open || '10:00').split(':').map(Number)
  const [ch] = (close || '17:00').split(':').map(Number)
  const out = []
  for (let h = oh; h <= ch; h++) out.push(`${String(h).padStart(2, '0')}:00`)
  return out
}

export default function DoctorCalendar() {
  const [appts, setAppts] = useState(null)
  const [settings, setSettings] = useState(null)
  const [view, setView] = useState('Day')
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10))
  // default to a day that has appointments (demo-friendly); fallback to today
  const [err, setErr] = useState('')

  const load = async () => {
    listAppointments().then(setAppts).catch((e) => setErr(e.message))
    getClinicSettings().then(setSettings).catch((e) => setErr(e.message))
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!appts?.length) return
    const today = new Date().toISOString().slice(0, 10)
    const upcoming = (appts || []).map((a) => (a.scheduled_at || a.requested_date || '').slice(0, 10)).filter((d) => d >= today).sort()[0]
    const any = (appts || []).map((a) => (a.scheduled_at || a.requested_date || '').slice(0, 10)).sort()[0]
    setDay(upcoming || any || today)
  }, [appts])
  useRevalidateOnVisible(load)

  const dayAppts = (appts ?? [])
    .filter((a) => (a.scheduled_at || a.requested_date || '').slice(0, 10) === day && a.status !== 'cancelled')
    .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))

  const heading = new Date(day + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const slots = hoursFor(settings?.open_time, settings?.close_time)
  // local-hour keys — scheduled_at is UTC; slice(11,13) matched UTC hours (bug)
  const booked = new Set(dayAppts.map((a) => a.scheduled_at ? String(new Date(a.scheduled_at).getHours()).padStart(2, '0') : null))

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
        <p className="text-xs text-gray-500">Color-coded by appointment status</p>
      </div>

      {/* legend chips (Figma p42) */}
      <div className="flex gap-2">
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700">Completed</span>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">Pending</span>
        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-red-50 text-red-600">Cancelled</span>
      </div>

      {/* Day / Week / Month segmented control (Figma) */}
      <div className="flex bg-white border border-gray-200 rounded-lg p-1 text-sm font-semibold">
        {['Day', 'Week', 'Month'].map((v) => (
          <button key={v} onClick={() => setView(v)}
                  className={'flex-1 min-h-[44px] rounded-md ' + (view === v ? 'bg-primary-50 text-primary-700' : 'text-gray-500')}>
            {v}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous day" onClick={() => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() - 1); setDay(d.toISOString().slice(0, 10)) }}
                className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600">‹</button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
             className="h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600" />
        <button type="button" aria-label="Next day" onClick={() => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + 1); setDay(d.toISOString().slice(0, 10)) }}
                className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600">›</button>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}
      {!appts && <Skel lines={3} h="h-16" />}

      <div className="text-sm font-bold text-gray-900">{heading} <span className="text-xs font-medium text-gray-500">· {dayAppts.length} appointment{dayAppts.length !== 1 ? 's' : ''}</span></div>

      {/* hour grid with blocks (Figma day view) */}
      {view === 'Day' && (
        <div className="space-y-1.5">
          {/* appointments without a scheduled time (pending/unscheduled) render first */}
          {dayAppts.filter((a) => !a.scheduled_at).map((a) => (
            <div key={a.id} className="flex gap-2 items-stretch">
              <div className="w-16 text-xs font-bold text-gray-400 flex items-center flex-none">TBA</div>
              <div className={'flex-1 bg-white border border-gray-200 border-l-4 rounded-lg px-3 py-2 ' + (STATUS_PILL[a.status] || 'border-l-gray-400')}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-900">Unscheduled</span>
                  <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded capitalize ' + (STATUS_PILL[a.status] || '')}>{a.status}</span>
                </div>
                <div className="text-sm font-semibold text-gray-900">{a.patients?.full_name}</div>
                <div className="text-xs text-gray-500">{a.services?.name}</div>
              </div>
            </div>
          ))}
          {slots.map((h) => {
            const block = dayAppts.find((a) => a.scheduled_at && String((new Date(a.scheduled_at).getUTCHours() + 8) % 24).padStart(2, '0') === h.slice(0, 2))
            return (
              <div key={h} className="flex gap-2 items-stretch">
                <div className="w-16 text-xs font-bold text-gray-900 flex items-center flex-none">{fmtTime12(h).replace(':00', '')}</div>
                {block ? (
                  <div className={'flex-1 bg-white border border-gray-200 border-l-4 rounded-lg px-3 py-2 ' + (STATUS_PILL[block.status] || 'border-l-gray-400')}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-900">{block.scheduled_at ? new Date(block.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'TBA'}</span>
                      <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded capitalize ' + (STATUS_PILL[block.status] || '')}>{block.status}</span>
                    </div>
                    <div className="text-sm font-semibold text-gray-900">{block.patients?.full_name}</div>
                    <div className="text-xs text-gray-500 flex items-center justify-between">
                      <span>{block.services?.name}</span>
                      {block.status === 'approved' && (
                        <button onClick={async () => {
                          try {
                            await setAppointmentStatus(block.id, 'completed')
                            setAppts((list) => list.map((x) => (x.id === block.id ? { ...x, status: 'completed' } : x)))
                          } catch (e) { alert(e.message) }
                        }} className="h-11 px-3 rounded-md bg-blue-600 text-white text-[11px] font-semibold">Mark completed</button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 border border-dashed border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-300 flex items-center">Open slot</div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {view === 'Week' && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5, 6].map((o) => {
            const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + o)
            const ds = d.toISOString().slice(0, 10)
            const items = (appts ?? []).filter((a) => (a.scheduled_at || a.requested_date || '').slice(0, 10) === ds && a.status !== 'cancelled')
            return (
              <div key={ds} className="bg-white border border-gray-200 rounded-lg px-3.5 py-2.5">
                <div className="text-xs font-bold text-gray-900">{d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} <span className="text-gray-500 font-medium">· {items.length} booked</span></div>
                {items.slice(0, 2).map((a) => (
                  <div key={a.id} className="text-xs text-gray-500 mt-1">{a.patients?.full_name} · {a.services?.name} {a.scheduled_at ? '· ' + fmtTime12(a.scheduled_at.slice(11, 16)) : ''}</div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {view === 'Month' && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-sm text-gray-500">{dayAppts.length} appointments on {heading}. Use Week view to browse the month.</div>
        </div>
      )}

      {/* summary card (Figma p42) */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3.5 divide-y divide-gray-200 text-sm">
        <div className="flex justify-between py-1">
          <span className="text-gray-600">Today</span>
          <span className="font-semibold text-gray-900">{appts?.filter((a) => (a.scheduled_at || a.requested_date || '').slice(0, 10) === new Date().toISOString().slice(0, 10) && a.status !== 'cancelled').length ?? 0} booked</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-gray-600">This week</span>
          <span className="font-semibold text-gray-900">{appts?.filter((a) => { const d = new Date(a.scheduled_at || a.requested_date); const n = new Date(); return a.status !== 'cancelled' && d >= new Date(n.getFullYear(), n.getMonth(), n.getDate()) && d < new Date(n.getFullYear(), n.getMonth(), n.getDate() + 7) }).length ?? 0} booked</span>
        </div>
      </div>
      <div className="h-4" />
    </div>
  )
}
