import { useRevalidateOnVisible } from '../lib/hooks'
import { useEffect, useState } from 'react'
import Skel from '../components/Skel'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/RoleContext'
import { listAppointments, listMyAppointments, getClinicSettings, peso, setAppointmentStatus } from '../lib/api'
import { fmtTime12 } from '../lib/format'

// Owner/Doctor home — Figma frame 48: date + hours header, KPI cards
// (Appointments · This week · Income Today), TODAY'S SCHEDULE with status pills,
// WEEK AHEAD, View full calendar button.

const STATUS_PILL = {
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  cancelled: 'bg-red-100 text-red-600',
}

export default function Home() {
  const { profile, patientRecord } = useAuth()
  const isStaff = profile?.role !== 'patient'
  const [appts, setAppts] = useState(null)
  const [settings, setSettings] = useState(null)
  const [err, setErr] = useState('')
  const [welcome, setWelcome] = useState(() => profile?.role === 'doctor' && !localStorage.getItem('dv_doc_welcomed'))

  const load = async () => {
    getClinicSettings().then(setSettings).catch(() => {})
    if (isStaff) listAppointments().then(setAppts).catch((e) => setErr(e?.message || "Couldn't load appointments — check your connection."))
    else if (patientRecord?.id) listMyAppointments(patientRecord.id).then(setAppts).catch((e) => setErr(e?.message || "Couldn't load appointments — check your connection."))
  }
  useEffect(() => { load() }, [isStaff])
  useRevalidateOnVisible(load)

  const now = new Date()
  const today = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
  const greetingWord = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'
  const hoursLine = settings
    ? `Clinic hours today: ${fmtTime12(settings.open_time)} – ${fmtTime12(settings.close_time)}`
    : 'Clinic hours today: 8:00 AM – 5:00 PM'

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
        <h1 className="text-xl font-bold text-gray-900">
          {isStaff ? today : `${greetingWord}, ${(profile?.full_name || '').split(' ')[0]}`}
        </h1>
        {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
        {appts === null && !err && <div className="mt-3"><Skel lines={2} h="h-20" /></div>}
        <p className="text-xs text-gray-500">{isStaff ? hoursLine : 'Welcome back to your dental care portal'}</p>
      </div>

      {isStaff && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Appointments</div>
              <div className="text-xl font-bold text-gray-900">{approved.length}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">This week</div>
              <div className="text-xl font-bold text-gray-900">{weekAhead.length}</div>
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
              {schedule.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-500">No appointments today.</div>}
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


          {/* WEEK AHEAD (Figma) */}
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Week ahead</h2>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {weekAhead.length === 0 && <div className="px-3.5 py-3 text-sm text-gray-500">Nothing scheduled in the next 7 days.</div>}
              {weekAhead.map((a) => (
                <div key={a.id} className="flex justify-between items-center px-3.5 py-2.5 text-sm">
                  <span className="text-gray-500 text-xs">{new Date(a.scheduled_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                  <span className="font-medium text-gray-900 truncate flex-1 text-right pr-2">{a.patients?.full_name} · {a.services?.name}</span>
                  <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded flex-none ' + (STATUS_PILL[a.status])}>Confirmed</span>
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
          {/* Upcoming appointment banner + card (Figma p34) */}
          {(() => {
            const upcoming = (appts ?? []).filter((a) => ['approved', 'pending'].includes(a.status))
              .sort((a, b) => (a.scheduled_at || a.requested_date).localeCompare(b.scheduled_at || b.requested_date))[0]
            if (!upcoming) {
              return (
                <div className="bg-green-50 border border-green-100 rounded-lg p-3.5 flex items-center gap-3">
                  <span className="text-green-600 flex-none">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                  </span>
                  <span className="text-xs text-gray-600">Welcome to the patient portal — book appointments, chat with the clinic, and track visits.</span>
                </div>
              )
            }
            const d = new Date(upcoming.scheduled_at || upcoming.requested_date + 'T00:00:00')
            const isApproved = upcoming.status === 'approved'
            return (
              <>
                <div className="bg-green-50 border border-green-100 rounded-lg p-3.5 flex items-center gap-3">
                  <span className="text-green-600 flex-none">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
                  </span>
                  <span className="text-xs text-green-700">
                    <b>Upcoming Appointment</b> — Your {upcoming.services?.name} on{' '}
                    {d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {upcoming.scheduled_at ? ` · ${fmtTime12(upcoming.scheduled_at.slice(11, 16))}` : ''} — {isApproved ? 'confirmed' : 'pay to confirm your slot'}.
                  </span>
                </div>
                <section>
                  {upcoming?.scheduled_at && Math.abs(new Date(upcoming.scheduled_at) - new Date(Date.now() + 864e5)) < 432e5 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 text-xs text-amber-800 font-semibold flex gap-2">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 flex-none mt-0.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  Visit tomorrow — arrive 10 minutes early and bring any previous X-rays.
                </div>
              )}
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Upcoming appointment</h2>
                  <Link to="/appointments" className="bg-white border border-gray-200 rounded-lg p-3.5 flex items-center gap-3">
                    <span className="w-12 rounded-lg bg-primary-50 text-primary-700 flex flex-col items-center py-1.5 flex-none">
                      <span className="text-[9px] font-bold uppercase">{d.toLocaleDateString('en-PH', { month: 'short' })}</span>
                      <span className="text-lg font-bold leading-none">{d.getDate()}</span>
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold text-gray-900 truncate">{upcoming.services?.name ?? 'Appointment'}</span>
                      <span className="block text-xs text-gray-500">
                        {d.toLocaleDateString('en-PH', { weekday: 'long' })}
                        {upcoming.scheduled_at ? ` · ${fmtTime12(upcoming.scheduled_at.slice(11, 16))}` : ''}
                      </span>
                    </span>
                  </Link>
                </section>
                <section>
                  <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Recent activity</h2>
                  <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-3">
                    <div className="text-sm font-semibold text-gray-900">
                      {(appts ?? [])[0]?.status === 'completed' ? 'Visit completed' : 'Book an Appointment'}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {(appts ?? [])[0]
                        ? `${(appts ?? [])[0].services?.name ?? 'Service'} · ${(appts ?? [])[0].requested_date ?? ''}`
                        : 'Your booking history will appear here.'}
                    </div>
                  </div>
                </section>
              </>
            )
          })()}
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

      {/* first-time dentist welcome (p48) */}
      {welcome && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center">
            <h2 className="text-lg font-bold text-gray-900">Welcome, Doc {(profile?.full_name || '').split(' ')[0]}!</h2>
            <p className="text-sm text-gray-500 mt-2">We're glad to have you here. Manage your appointments and connect with your patients with ease.</p>
            <button onClick={() => { localStorage.setItem('dv_doc_welcomed', '1'); setWelcome(false) }}
                    className="w-full h-11 mt-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Continue</button>
          </div>
        </div>
      )}
    </div>
  )
}