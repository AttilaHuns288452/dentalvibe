import { useEffect, useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { listAppointments, setAppointmentStatus, peso } from '../../lib/api'
import { StatusPill } from '../patient/MyAppointments'

// Approve (assign time) / Decline / Mark Completed — Figma frames 12, 32, 67.

export default function Requests() {
  const [appts, setAppts] = useState(null)
  const [err, setErr] = useState('')
  const [assigning, setAssigning] = useState(null)
  const [when, setWhen] = useState('')

  const load = () => listAppointments().then(setAppts).catch((e) => setErr(e.message))
  useEffect(load, [])

  const act = async (id, status, extra = {}) => {
    await setAppointmentStatus(id, status, extra)
    setAssigning(null)
    load()
  }

  const pending = (appts ?? []).filter((a) => a.status === 'pending')
  const active = (appts ?? []).filter((a) => a.status !== 'pending')

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Requests</h1>
        <p className="text-xs text-gray-500">Booking review &amp; time assignment</p>
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Pending ({pending.length})</h2>
        {!appts && <p className="text-sm text-gray-400">Loading…</p>}
        {appts && pending.length === 0 && <p className="text-sm text-gray-400 px-1">No pending requests.</p>}
        <div className="space-y-2">
          {pending.map((a) => (
            <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-3.5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm font-bold text-gray-900">{a.patients?.full_name || 'Patient'}</div>
                <StatusPill status={a.status} />
              </div>
              <div className="text-xs text-gray-500">{a.services?.name} · requested {a.requested_date || '—'}</div>
              {a.notes && <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 italic">"{a.notes}"</div>}
              {assigning === a.id ? (
                <div className="flex gap-2 items-center pt-1">
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                         className="flex-1 h-9 border border-gray-200 rounded-lg px-2 text-xs" />
                  <button onClick={() => act(a.id, 'approved', { scheduled_at: when, dentist_id: null })} disabled={!when}
                          className="h-9 px-3 rounded-lg bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">Confirm</button>
                  <button onClick={() => setAssigning(null)} className="h-9 px-3 rounded-lg border border-gray-200 text-xs text-gray-500">Cancel</button>
                </div>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => { setAssigning(a.id); setWhen('') }} className="flex-1 h-9 rounded-lg bg-primary-600 text-white text-xs font-semibold">Approve</button>
                  <button onClick={() => act(a.id, 'cancelled')} className="flex-1 h-9 rounded-lg border border-red-200 text-red-500 text-xs font-semibold bg-white">Decline</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Approved &amp; history</h2>
        <div className="space-y-2">
          {active.map((a) => (
            <div key={a.id} className="bg-white border border-gray-200 rounded-lg px-3.5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 text-sm font-semibold text-gray-900">{a.patients?.full_name}</div>
                <StatusPill status={a.status} />
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {a.services?.name} · {a.scheduled_at ? new Date(a.scheduled_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : a.requested_date}
                {a.services?.price ? ` · ${peso(a.services.price)}` : ''}
              </div>
              {a.status === 'approved' && (
                <button onClick={() => act(a.id, 'completed')} className="mt-2 h-8 px-3 rounded-lg bg-blue-600 text-white text-xs font-semibold">Mark Completed</button>
              )}
            </div>
          ))}
          {appts && active.length === 0 && <p className="text-sm text-gray-400 px-1">Nothing scheduled yet.</p>}
        </div>
      </section>
    </div>
  )
}
