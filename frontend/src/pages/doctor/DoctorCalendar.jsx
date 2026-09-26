import Skel from '../../components/Skel'
import { useRevalidateOnVisible } from '../../lib/hooks'
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { listAppointments, setAppointmentStatus, getClinicSettings } from '../../lib/api'
import { fmtTime12 } from '../../lib/format'
import { slotStartsFor, manilaDayKey, manilaHM, addDaysISO, TZ } from '../../lib/availability'
import { myDentist, readyStateForDate, setMyReady } from '../../lib/scheduling'

// Calendar Day view — Figma frame 29: Day/Week/Month seg control, formatted date
// heading, hour rows with color-coded appointment blocks (time · name · service).

const STATUS_PILL = {
  approved: 'bg-green-100 text-green-700 border-l-green-500',
  completed: 'bg-blue-100 text-blue-700 border-l-blue-500',
  pending: 'bg-amber-100 text-amber-700 border-l-amber-500',
  cancelled: 'bg-red-100 text-red-600 border-l-red-500',
}

// Manila calendar day key for an appointment — scheduled_at is an instant (timestamptz),
// requested_date is a plain date. Never slice the ISO string: its date part is UTC.
const apptDay = (a) => (a.scheduled_at ? manilaDayKey(new Date(a.scheduled_at)) : (a.requested_date || '').slice(0, 10))

// 30-min grid row ('HH:MM') an appointment's Manila start time falls into.
const slotOf = (a) => {
  const t = manilaHM(new Date(a.scheduled_at))
  return t.slice(0, 3) + (t.slice(3) < '30' ? '00' : '30')
}

export default function DoctorCalendar() {
  const { profile, deactivated } = useAuth()
  const isOwner = profile?.role === 'owner'
  const [appts, setAppts] = useState(null)
  const [settings, setSettings] = useState(null)
  const [me, setMe] = useState(null) // my dentists row (email → dentists.id)
  const [ready, setReady] = useState(null) // dentist_ready for Manila today: true | false | null (no row)
  const [view, setView] = useState('Day')
  const [day, setDay] = useState(() => manilaDayKey(new Date())) // Manila "today", not UTC
  // default to a day that has appointments (demo-friendly); fallback to today
  const [err, setErr] = useState('')

  const load = async () => {
    listAppointments().then(setAppts).catch((e) => setErr(e.message))
    getClinicSettings().then(setSettings).catch((e) => setErr(e.message))
    Promise.all([myDentist(), readyStateForDate(manilaDayKey(new Date()))])
      .then(([d, state]) => { setMe(d); setReady(state.find((r) => r.id === d?.id)?.ready ?? null) })
      .catch((e) => setErr(e.message))
  }
  useEffect(() => { load() }, [])
  useRevalidateOnVisible(load)

  // doctors see their own assigned visits (+ unassigned unscheduled rows as TBA); owner sees all
  const visible = useMemo(() => (appts ?? []).filter(
    (a) => isOwner || a.dentist_id === me?.id || (!a.dentist_id && !a.scheduled_at),
  ), [appts, me?.id, isOwner])

  useEffect(() => {
    if (!visible.length) return
    const today = manilaDayKey(new Date())
    const keys = visible.map(apptDay).filter(Boolean).sort()
    setDay(keys.find((d) => d >= today) || keys[0] || today)
  }, [visible])

  const dayAppts = visible
    .filter((a) => apptDay(a) === day && a.status !== 'cancelled')
    .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))

  const heading = new Date(day + 'T12:00:00Z').toLocaleDateString([], { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' })
  // day grid derives from clinic_settings via the same availability model patient booking uses —
  // the two roles can never disagree. Full 30-min open-hours grid, no busy ranges.
  const slots = settings ? slotStartsFor(settings, day, 30, []) : []

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Calendar</h1>
        <p className="text-xs text-gray-500">Color-coded by appointment status</p>
      </div>

      {/* Ready-for-today presence toggle (dentist_ready per Manila clinic date) */}
      {me && (
        <button type="button" data-testid="ready-toggle" disabled={deactivated}
                onClick={async () => {
                  try { const next = ready === false; await setMyReady(next); setReady(next) }
                  catch (e) { alert(e.message) }
                }}
                className={'w-full h-12 rounded-lg text-sm font-bold border ' +
                  (deactivated ? 'bg-gray-100 text-gray-400 border-gray-200'
                    : ready === false ? 'bg-red-50 text-red-600 border-red-200'
                    : 'bg-green-600 text-white border-green-600')}>
          {deactivated ? 'Account deactivated' : ready === false ? 'Not Ready' : 'Ready for Today'}
        </button>
      )}

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
        <button type="button" aria-label="Previous day" onClick={() => setDay(addDaysISO(day, -1))}
                className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600">‹</button>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
             className="h-9 px-2.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-600" />
        <button type="button" aria-label="Next day" onClick={() => setDay(addDaysISO(day, 1))}
                className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600">›</button>
      </div>

      {err && <p className="text-xs text-red-500">{err}</p>}
      {!appts && <Skel lines={3} h="h-16" />}

      <div className="text-sm font-bold text-gray-900">{heading} <span className="text-xs font-medium text-gray-500">· {dayAppts.length} appointment{dayAppts.length !== 1 ? 's' : ''}</span></div>

      {/* hour grid with blocks (Figma day view) */}
      {view === 'Day' && (
        <div className="space-y-1.5">
          {/* unscheduled (no time) and off-grid appointments render first */}
          {dayAppts.filter((a) => !a.scheduled_at || !slots.includes(slotOf(a))).map((a) => (
            <div key={a.id} className="flex gap-2 items-stretch">
              <div className="w-16 text-xs font-bold text-gray-400 flex items-center flex-none">{a.scheduled_at ? fmtTime12(manilaHM(new Date(a.scheduled_at))) : 'TBA'}</div>
              <div className={'flex-1 bg-white border border-gray-200 border-l-4 rounded-lg px-3 py-2 ' + (STATUS_PILL[a.status] || 'border-l-gray-400')}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-900">{a.scheduled_at ? 'Off-hours' : 'Unscheduled'}</span>
                  <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded capitalize ' + (STATUS_PILL[a.status] || '')}>{a.status}</span>
                </div>
                <div className="text-sm font-semibold text-gray-900">{a.patients?.full_name}</div>
                <div className="text-xs text-gray-500">{a.services?.name}{a.dentists?.full_name ? ' · ' + a.dentists.full_name : ''}</div>
              </div>
            </div>
          ))}
          {slots.map((h) => {
            const block = dayAppts.find((a) => a.scheduled_at && slotOf(a) === h)
            return (
              <div key={h} className="flex gap-2 items-stretch">
                <div className="w-16 text-xs font-bold text-gray-900 flex items-center flex-none">{fmtTime12(h).replace(':00', '')}</div>
                {block ? (
                  <div className={'flex-1 bg-white border border-gray-200 border-l-4 rounded-lg px-3 py-2 ' + (STATUS_PILL[block.status] || 'border-l-gray-400')}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-900">{block.scheduled_at ? fmtTime12(manilaHM(new Date(block.scheduled_at))) : 'TBA'}</span>
                      <span className={'text-[10px] font-bold px-1.5 py-0.5 rounded capitalize ' + (STATUS_PILL[block.status] || '')}>{block.status}</span>
                    </div>
                    <div className="text-sm font-semibold text-gray-900">{block.patients?.full_name}</div>
                    <div className="text-xs text-gray-500 flex items-center justify-between">
                      <span>{block.services?.name} · {block.duration_minutes || 30} min{block.dentists?.full_name ? ' · ' + block.dentists.full_name : ''}</span>
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
            const ds = addDaysISO(day, o)
            const items = visible.filter((a) => apptDay(a) === ds && a.status !== 'cancelled')
            return (
              <div key={ds} className="bg-white border border-gray-200 rounded-lg px-3.5 py-2.5">
                <div className="text-xs font-bold text-gray-900">{new Date(ds + 'T12:00:00Z').toLocaleDateString([], { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' })} <span className="text-gray-500 font-medium">· {items.length} booked</span></div>
                {items.slice(0, 2).map((a) => (
                  <div key={a.id} className="text-xs text-gray-500 mt-1">{a.patients?.full_name} · {a.services?.name} {a.scheduled_at ? '· ' + fmtTime12(manilaHM(new Date(a.scheduled_at))) : ''}</div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {view === 'Month' && (() => {
        const firstKey = day.slice(0, 8) + '01'
        const first = new Date(firstKey + 'T12:00:00Z')
        const startDow = first.getUTCDay()
        const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate()
        const todayKey = manilaDayKey(new Date())
        const cells = []
        for (let i = 0; i < startDow; i++) cells.push(null)
        for (let dnum = 1; dnum <= daysInMonth; dnum++) cells.push(dnum)
        return (
          <div>
            <div className="grid grid-cols-7 gap-1 text-[10px] font-bold text-gray-400 text-center mb-1">
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <div key={i}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((dnum, i) => {
                if (!dnum) return <div key={'e' + i} />
                const ds = firstKey.slice(0, 8) + String(dnum).padStart(2, '0')
                const items = visible.filter((a) => apptDay(a) === ds && a.status !== 'cancelled')
                const isToday = ds === todayKey
                return (
                  <button key={ds} onClick={() => { setDay(ds); setView('Day') }} className={'min-h-14 rounded-lg border p-1 text-left ' + (isToday ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white')}>
                    <div className="text-[10px] font-bold text-gray-900">{dnum}</div>
                    {items.length > 0 && <div className="text-[9px] font-semibold text-gray-700">{items.length} booked</div>}
                    {items.slice(0, 1).map((a) => <div key={a.id} className="text-[9px] text-gray-500 truncate">{a.patients?.full_name}</div>)}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* summary card (Figma p42) */}
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3.5 divide-y divide-gray-200 text-sm">
        <div className="flex justify-between py-1">
          <span className="text-gray-600">Today</span>
          <span className="font-semibold text-gray-900">{visible.filter((a) => apptDay(a) === manilaDayKey(new Date()) && a.status !== 'cancelled').length} booked</span>
        </div>
        <div className="flex justify-between py-1">
          <span className="text-gray-600">This week</span>
          <span className="font-semibold text-gray-900">{(() => {
            const t0 = manilaDayKey(new Date()); const t7 = addDaysISO(t0, 7)
            return visible.filter((a) => { const d = apptDay(a); return a.status !== 'cancelled' && d >= t0 && d < t7 }).length
          })()} booked</span>
        </div>
      </div>
      <div className="h-4" />
    </div>
  )
}
