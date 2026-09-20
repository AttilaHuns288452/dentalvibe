import { useEffect, useState } from 'react'
import { useAuth } from '../context/RoleContext'
import { listAppointments, getClinicSettings } from '../lib/api'

// Role-aware home per the Figma dashboards: patient greeting + quick actions;
// doctor/owner get KPIs, booking-requests banner, today's schedule.

function QuickAction({ icon, label, sub, href }) {
  return (
    <a href={'#' + href} className="bg-white border border-gray-200 rounded-lg p-3.5 flex flex-col gap-2">
      <span className="w-9 h-9 rounded-lg bg-primary-50 text-primary-700 flex items-center justify-center">{icon}</span>
      <span className="text-sm font-semibold text-gray-900">{label}</span>
      <span className="text-[11px] text-gray-500 -mt-1.5">{sub}</span>
    </a>
  )
}

const icons = {
  cal: <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" /></svg>,
  clock: <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  chat: <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>,
  user: <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" /></svg>,
}

export default function Home() {
  const { profile, patientRecord } = useAuth()
  const [appts, setAppts] = useState(null)
  const [settings, setSettings] = useState(null)

  useEffect(() => {
    getClinicSettings().then(setSettings).catch(() => {})
    if (profile?.role !== 'patient') listAppointments().then(setAppts).catch(() => {})
  }, [profile?.role])

  const isStaff = profile?.role !== 'patient'
  const pending = (appts ?? []).filter((a) => a.status === 'pending')
  const today = (appts ?? []).filter((a) => a.status === 'approved' && a.scheduled_at && new Date(a.scheduled_at).toDateString() === new Date().toDateString())

  const fmtHours = settings
    ? `${settings.open_days.join(', ')} · ${settings.open_time}–${settings.close_time}`
    : 'Mon–Sat · 8:00–17:00'

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">
          {isStaff ? new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : `Good day, ${(profile?.full_name || '').split(' ')[0]}`}
        </h1>
        <p className="text-xs text-gray-500">Clinic hours: {fmtHours}</p>
      </div>

      {isStaff && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Appointments</div>
              <div className="text-xl font-bold text-gray-900">{today.length}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Pending</div>
              <div className="text-xl font-bold text-gray-900">{pending.length}</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg px-3 py-2.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{profile.role === 'owner' ? 'Patients' : 'History'}</div>
              <div className="text-xl font-bold text-gray-900">{appts ? (profile.role === 'owner' ? new Set((appts ?? []).map((a) => a.patient_id)).size : (appts ?? []).length) : '…'}</div>
            </div>
          </div>

          {pending.length > 0 && (
            <a href={profile.role === 'owner' ? '#/owner/requests' : '#/doctor/requests'} className="block bg-white border border-gray-200 rounded-lg p-3.5">
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
            </a>
          )}

          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Approved appointments</h2>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {(appts ?? []).filter((a) => a.status === 'approved').slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="text-xs font-bold text-gray-900 w-16 flex-none">{a.scheduled_at ? new Date(a.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'TBA'}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-gray-900 truncate">{a.patients?.full_name}</div>
                    <div className="text-xs text-gray-500">{a.services?.name}</div>
                  </div>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-green-100 text-green-700">Upcoming</span>
                </div>
              ))}
              {(appts ?? []).filter((a) => a.status === 'approved').length === 0 && (
                <div className="px-3.5 py-3 text-sm text-gray-400">No approved appointments yet.</div>
              )}
            </div>
          </section>
        </>
      )}

      {!isStaff && (
        <>
          <div className="notif bg-green-50 border border-green-100 rounded-lg p-3.5 flex items-center gap-3">
            <span className="text-green-600 flex-none">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
            </span>
            <span className="text-xs text-gray-600">Welcome to the patient portal — book appointments, chat with the clinic, and track visits.</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <QuickAction icon={icons.cal} label="Book Appointment" sub="Pick a service & date" href="/book" />
            <QuickAction icon={icons.clock} label="My Appointments" sub="Track requests" href="/appointments" />
            <QuickAction icon={icons.chat} label="Messages" sub="Chat with the clinic" href="/messages" />
            <QuickAction icon={icons.user} label="My Profile" sub="Account & info" href="/profile" />
          </div>
        </>
      )}
    </div>
  )
}
