import Skel from '../../components/Skel'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, getClinicSettings } from '../../lib/api'
import { manilaDayKey, manilaHM, manilaToInstant, TZ } from '../../lib/availability'
import { myDentist, setMyReady } from '../../lib/scheduling'

// Owner Schedules — the OWNER's side of the locked capacity model:
//   (a) per-dentist WORK SCHEDULE editor (dentist_work_schedules) — booking capacity
//       comes ONLY from these rows (+ dentists.active); a dentist with no active row
//       is labeled "No working schedule — not bookable";
//   (b) TODAY'S OPERATIONS: scheduled (work schedule) vs Ready/Not Ready (dentist_ready,
//       day-of ops state) + appointment counts;
//   (c) CONFLICT WARNINGS — display only, never auto-cancel/move anything;
//   (d) owner-as-provider: the owner's own Ready toggle if they have a dentist row.
// RLS enforces owner-only writes — this page just upserts.

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] // day_of_week 0=Sunday
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday-first display

export default function OwnerSchedules() {
  const navigate = useNavigate()
  const [dentists, setDentists] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [readyRows, setReadyRows] = useState([])
  const [appts, setAppts] = useState([])
  const [me, setMe] = useState(null)
  const [myReady, setMyReadyState] = useState(null)
  const [draft, setDraft] = useState({}) // dentistId -> [{day_of_week, active, open_time, close_time}]
  const [msg, setMsg] = useState({}) // dentistId -> {ok, text}
  const [err, setErr] = useState('')
  const today = manilaDayKey(new Date()) // Manila clinic date, not the browser's

  const load = async () => {
    try {
      const [d, s, r, a, st, m] = await Promise.all([
        supabase.from('dentists').select('id, full_name, email, active').order('full_name'),
        supabase.from('dentist_work_schedules').select('dentist_id, day_of_week, open_time, close_time, active'),
        supabase.from('dentist_ready').select('dentist_id, ready').eq('clinic_date', today),
        supabase.from('appointments').select('id, dentist_id, scheduled_at, status, payment_status')
          .gte('scheduled_at', manilaToInstant(today, '00:00').toISOString()),
        getClinicSettings(),
        myDentist(),
      ])
      for (const res of [d, s, r, a]) if (res.error) throw res.error
      setDentists(d.data ?? [])
      setSchedules(s.data ?? [])
      setReadyRows(r.data ?? [])
      setAppts((a.data ?? []).filter((x) => x.scheduled_at))
      setMe(m)
      setMyReadyState(r.data?.find((x) => x.dentist_id === m?.id)?.ready ?? null)
      // draft mirrors the saved rows (times as 'HH:MM'); missing rows default to clinic hours
      const defOpen = (st.open_time ?? '10:00').slice(0, 5)
      const defClose = (st.close_time ?? '17:00').slice(0, 5)
      const out = {}
      for (const den of d.data ?? []) {
        out[den.id] = DOW_ORDER.map((dow) => {
          const row = (s.data ?? []).find((x) => x.dentist_id === den.id && x.day_of_week === dow)
          return {
            day_of_week: dow,
            active: !!row?.active,
            open_time: (row?.open_time ?? defOpen).slice(0, 5),
            close_time: (row?.close_time ?? defClose).slice(0, 5),
          }
        })
      }
      setDraft(out)
    } catch (e) {
      setErr(e.message)
    }
  }
  useEffect(() => { load() }, [])

  const setRow = (id, dow, patch) =>
    setDraft((dr) => ({ ...dr, [id]: dr[id].map((r) => (r.day_of_week === dow ? { ...r, ...patch } : r)) }))

  const saveDentist = async (id) => {
    const rows = draft[id] ?? []
    if (rows.some((r) => r.close_time <= r.open_time)) {
      setMsg((m2) => ({ ...m2, [id]: { ok: false, text: 'Close time must be after open time.' } }))
      return
    }
    const payload = rows.map((r) => ({
      dentist_id: id, day_of_week: r.day_of_week, open_time: r.open_time,
      close_time: r.close_time, active: r.active, updated_at: new Date().toISOString(),
    }))
    const { error } = await supabase.from('dentist_work_schedules')
      .upsert(payload, { onConflict: 'dentist_id,day_of_week' })
    setMsg((m2) => ({ ...m2, [id]: error ? { ok: false, text: error.message } : { ok: true, text: 'Saved ✓' } }))
    if (!error) load()
  }

  // ── today's ops math (Manila day; reserved = pending/paid, not cancelled) ──
  const dayStart = manilaToInstant(today, '00:00').getTime()
  const dayEnd = dayStart + 864e5
  const todayDow = new Date(today + 'T12:00:00Z').getUTCDay() // noon-UTC anchor = Manila weekday (no DST)
  const reserved = appts.filter((a) => ['pending', 'paid'].includes(a.payment_status) && a.status !== 'cancelled')
  const todayAppts = reserved.filter((a) => { const t = new Date(a.scheduled_at).getTime(); return t >= dayStart && t < dayEnd })
  const scheduledToday = (dentists ?? []).filter((den) => den.active &&
    schedules.some((x) => x.dentist_id === den.id && x.day_of_week === todayDow && x.active))
  const readyFor = (id) => readyRows.find((x) => x.dentist_id === id)?.ready
  const nScheduled = scheduledToday.length
  const nReady = scheduledToday.filter((den) => readyFor(den.id) === true).length
  const nAppts = todayAppts.length

  // conflict warnings — display only (no auto-cancel/move)
  const hourCounts = {}
  for (const a of todayAppts) {
    const h = manilaHM(new Date(a.scheduled_at)).slice(0, 2) + ':00'
    hourCounts[h] = (hourCounts[h] ?? 0) + 1
  }
  const warnings = Object.entries(hourCounts).sort()
    .filter(([h, x]) => x > nReady)
    .map(([h, x]) => `${x} appointments at ${h} but only ${nReady} dentists Ready`)
  const future = reserved.filter((a) => new Date(a.scheduled_at).getTime() > Date.now())
  for (const den of (dentists ?? []).filter((x) => !x.active)) {
    const k = future.filter((a) => a.dentist_id === den.id).length
    if (k) warnings.push(`${den.full_name} is deactivated but has ${k} future appointment${k === 1 ? '' : 's'} — reassign or cancel manually`)
  }

  if (!dentists) return <div className="px-4 py-4"><Skel lines={3} h="h-16" /></div>

  return (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => navigate('/owner/manage')} aria-label="Back" className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </button>
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dentist Schedules</h1>
        <p className="text-xs text-gray-500">Work schedules · today's operations</p>
      </div>

      {/* (a) per-dentist work schedule editor — the ONLY source of booking capacity */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Work schedules</h2>
        <p className="text-xs text-gray-500 mb-2">Booking capacity comes only from these rows — a dentist with no active day is not bookable.</p>
        <div className="space-y-2">
          {dentists.map((d) => {
            const rows = draft[d.id] ?? []
            const anyActive = rows.some((r) => r.active)
            return (
              <div key={d.id} className="bg-white border border-gray-200 rounded-lg p-3.5 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex-1 text-sm font-semibold text-gray-900">{d.full_name}</span>
                  {!d.active && <span className="text-[11px] font-bold bg-red-100 text-red-600 rounded px-1.5 py-0.5">Deactivated</span>}
                  {!anyActive && <span data-testid={`sched-none-${d.id}`} className="text-[11px] font-bold bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">No working schedule — not bookable</span>}
                </div>
                {rows.map((r) => (
                  <div key={r.day_of_week} data-testid={`sched-row-${d.id}-${r.day_of_week}`} className="flex items-center gap-2">
                    <span className="w-8 text-xs font-bold text-gray-600">{DOW_LABELS[r.day_of_week]}</span>
                    <button type="button" data-testid={`sched-day-${d.id}-${r.day_of_week}`} onClick={() => setRow(d.id, r.day_of_week, { active: !r.active })}
                            className={'w-11 h-7 rounded-full text-[10px] font-bold border ' + (r.active ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-400')}>
                      {r.active ? 'ON' : 'OFF'}
                    </button>
                    <input type="time" value={r.open_time} onChange={(e) => setRow(d.id, r.day_of_week, { open_time: e.target.value })}
                           className="h-9 px-2 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700" />
                    <span className="text-gray-400 text-xs font-bold">–</span>
                    <input type="time" value={r.close_time} onChange={(e) => setRow(d.id, r.day_of_week, { close_time: e.target.value })}
                           className="h-9 px-2 border border-gray-200 rounded-lg text-xs font-semibold text-gray-700" />
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <button data-testid={`sched-save-${d.id}`} onClick={() => saveDentist(d.id)}
                          className="h-9 px-4 rounded-lg bg-primary-600 text-white text-xs font-semibold">Save</button>
                  {msg[d.id] && (
                    <span data-testid={`sched-msg-${d.id}`} className={'text-xs font-semibold ' + (msg[d.id].ok ? 'text-green-600' : 'text-red-500')}>{msg[d.id].text}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* (b) TODAY'S OPERATIONS */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Today's operations</h2>
        <div className="bg-white border border-gray-200 rounded-lg p-3.5 space-y-2">
          <div className="text-xs font-bold text-gray-900">
            {new Date(today + 'T12:00:00Z').toLocaleDateString([], { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <div data-testid="capacity-line" className="text-xs font-semibold text-primary-700">
            {nScheduled} scheduled · {nReady} Ready · {nAppts} appointments today
          </div>
          {dentists.map((d) => {
            const row = schedules.find((x) => x.dentist_id === d.id && x.day_of_week === todayDow && x.active)
            const anyActive = schedules.some((x) => x.dentist_id === d.id && x.active)
            const k = todayAppts.filter((a) => a.dentist_id === d.id).length
            return (
              <div key={d.id} data-testid={`ops-${d.id}`} className="flex items-center gap-2 text-xs border-t border-gray-100 pt-2">
                <span className="flex-1 font-semibold text-gray-900">{d.full_name}</span>
                {!d.active && <span className="text-[10px] font-bold bg-red-100 text-red-600 rounded px-1.5 py-0.5">Deactivated</span>}
                <span className="text-gray-500">{row ? `Scheduled ${row.open_time.slice(0, 5)}–${row.close_time.slice(0, 5)}` : anyActive ? 'Not scheduled today' : 'No working schedule — not bookable'}</span>
                <span className={'font-bold px-1.5 py-0.5 rounded ' + (readyFor(d.id) === true ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')}>
                  {readyFor(d.id) === true ? 'Ready' : 'Not Ready'}
                </span>
                <span className="text-gray-500 tabular-nums">{k} appt{k !== 1 ? 's' : ''}</span>
              </div>
            )
          })}
        </div>
      </section>

      {/* (c) CONFLICT WARNINGS — display only */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Conflict warnings</h2>
        <div data-testid="conflict-warnings" className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-2.5 text-xs font-semibold text-amber-800">{w}</div>
          ))}
          {!warnings.length && (
            <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-2.5 text-xs text-gray-500">No conflicts — nothing to review.</div>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-1.5">Warnings are review-only — nothing is cancelled or moved automatically.</p>
      </section>

      {/* (d) owner-as-provider: own presence toggle, or the explicit non-provider note */}
      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Today's presence · {myReady === true ? 'Ready' : 'Not Ready'}</h2>
        {me ? (
          <div>
            <button type="button" data-testid="ready-toggle" onClick={async () => {
                    // null (fresh day) and false both mean NOT READY
                    try { const next = myReady !== true; await setMyReady(next); setMyReadyState(next) }
                    catch (e) { setErr(e.message) }
                  }}
                    className={'w-full h-12 rounded-lg text-sm font-bold border ' +
                      (myReady === true ? 'bg-green-600 text-white border-green-600' : 'bg-red-50 text-red-600 border-red-200')}>
              {myReady === true ? 'Not Ready' : 'Ready for Today'}
            </button>
            <p className="text-[11px] text-gray-400 mt-1">Operational signal only — patient booking is never affected by this.</p>
          </div>
        ) : (
          <p data-testid="owner-note" className="text-xs text-gray-500">
            You have no dentist row and no work schedule — you are never a bookable resource.
          </p>
        )}
      </section>

      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="h-4" />
    </div>
  )
}
