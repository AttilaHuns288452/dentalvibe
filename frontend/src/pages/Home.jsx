import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/RoleContext'
import { listAppointments, getClinicSettings, peso, setAppointmentStatus } from '../lib/api'
import { fmtTime12 } from '../lib/format'

// Owner/Doctor home — Figma frame 48: date + hours header, KPI cards
// (Appointments · Pending · Income Today), TODAY'S SCHEDULE with status pills,
// booking-requests banner, WEEK AHEAD, View full calendar button.

const STATUS_PILL = {
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-600',
}

export default function Home() {
  const { profile } = useAuth()
  const isStaff = profile?.role !== 'patient'
  const [appts, setAppts] = useState(null)
  const [settings, setSettings] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    getClinicSettings().then(setSettings).catch(() => {})
    if (isStaff) listAppointments().then(setAppts).catch((e) => setErr(e.message))
  }, [isStaff])

  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const hoursLine = settings
    ? `Clinic hours today: ${fmtTime12(settings.open_time)} – ${fmtTime12(settings.close_time)}`
    : 'Clinic hours today: 8:00 AM – 5:00 PM'

  const pending = (appts ?? []).filter((a) => a.status === 'pending')
  const approved = (appts ?? []).filter((a) => a.status === 'approved')
  const todayStr = new Date().toISOString().slice(0, 10)
  const todays = approved.filter((a) => (a.scheduled_at || '').slice(0, 10) === todayStr)
  const incomeToday = (appts ?? [])
    .filter((a) => a.status === 'completed' && (a.scheduled_at || '').slice(0, 10) === todayStr)
    .reduce((s, a) => s + Number(a.price ?? a.services?.price ?? 0), 0)

  // week ahead: approved in next 7 days, grouped by day
  const weekAhead = approved
    .filter((a) => {
      const d = (a.scheduled_at || '').slice(0, 10)
      return d > todayStr && d <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)
    })
    .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))
    .slice(0, 3)

  const schedule = (todays.length ? todays : approved.slice(0, 3))
    .slice()
    .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{today}</h1>
        <p className="text-xs text-gray-500">{isStaff ? hoursLine : `Welcome, ${(profile?.full_name || '').split(' ')[0]} — your dental care portal`}</p>
      </div>

      {isStaff && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Appointments</div>
              <div className="text-xl font-bold text-gray-900">{approved.length}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Pending</div>
              <div className="text-xl font-bold text-gray-900">{pending.length}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Income Today</div>
              <div className="text-xl font-bold text-gray-900">{peso(incomeToday)}</div>
            </div>
          </div>

          {/* TODAY'S SCHEDULE (Figma) */}
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Today's schedule</h2>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {schedule.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-400">No appointments today.</div>}
              {schedule.map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="text-xs font-bold text-gray-900 w-16 flex-none">{a.scheduled_at ? new Date(a.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'TBA'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{a.patients?.full_name}</div>
                    <div className="text-xs text-gray-500">{a.services?.name}</div>
                  </div>
                  <span className={'text-[11px] font-bold px-2 py-0.5 rounded flex-none ' + (STATUS_PILL[a.status] || 'bg-gray-100 text-gray-600')}>{a.status === 'approved' ? 'Upcoming' : a.status}</span>
                </div>
              ))}
            </div>
          </section>

          {/* booking requests banner (Figma: after schedule) */}
          {pending.length > 0 && (
            <Link to={profile.role === 'owner' ? '/owner/requests' : '/doctor/requests'} className="block bg-white border border-gray-200 rounded-lg p-3.5">
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center flex-none">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M10.3 21a1.9 1.9 0 0 0 3.4 0" /></svg>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-gray-900">{pending.length} booking request{pending.length !== 1 ? 's' : ''} waiting</span>
                  <span className="block text-xs text-gray-500">Review and assign times in Requests</span>
                </span>
                <span className="h-8 px-3 rounded-lg bg-primary-600 text-white text-xs font-semibold flex items-center flex-none">Review</span>
              </div>
            </Link>
          )}

          {/* WEEK AHEAD (Figma) */}
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Week ahead</h2>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {weekAhead.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-400">Nothing scheduled in the next 7 days.</div>}
              {weekAhead.map((a) => (
                <div key={a.id} className="flex justify-between items-center px-3.5 py-2.5 text-sm">
                  <span className="text-gray-500 text-xs">{new Date(a.scheduled_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="font-medium text-gray-900 truncate flex-1 text-right pr-2">{a.patients?.full_name} · {a.services?.name}</span>
                  <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded flex-none ' + (STATUS_PILL[a.status])}>approved</span>
                </div>
              ))}
            </div>
          </section>

          {/* View full calendar (Figma) */}
          <Link to={profile.role === 'owner' ? '/owner/calendar' : '/doctor/calendar'}
                className="block text-center bg-white border border-gray-200 rounded-lg py-2.5 text-sm font-semibold text-gray-700">
            View full calendar
          </Link>
        </>
      )}

      {!isStaff && (
        <>
          <div className="bg-green-50 border border-green-100 rounded-lg p-3.5 flex items-center gap-3">
            <span className="text-green-600 flex-none">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
            </span>
            <span className="text-xs text-gray-600">Welcome to the patient portal — book appointments, chat with the clinic, and track visits.</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Book Appointment', 'Pick a service & date', '/book'],
              ['My Appointments', 'Track requests', '/appointments'],
              ['Messages', 'Chat with the clinic', '/messages'],
              ['My Profile', 'Account & info', '/profile'],
            ].map(([label, sub, href]) => (
              <Link key={href} to={href} className="bg-white border border-gray-200 rounded-lg p-3.5 flex flex-col gap-2">
                <span className="w-9 h-9 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={href === '/book' ? 'M12 5v14M5 12h14' : href === '/appointments' ? 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4' : href === '/messages' ? 'M7.9 20A9 9 0 1 0 4 16.1L2 22Z' : 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8M4 21c0-4 3.6-6 8-6s8 2 8 6'} /></svg>
                </span>
                <span className="text-sm font-semibold text-gray-900">{label}</span>
                <span className="text-[11px] text-gray-500 -mt-1.5">{sub}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {err && <p className="text-xs text-red-500">{err}</p>}
    </div>
  )
}
