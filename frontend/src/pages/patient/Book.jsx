import { useEffect, useMemo, useState } from 'react'
import Skel from '../../components/Skel'
import { useStickyState } from '../../lib/hooks'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { listServices, bookAppointment, peso, supabase } from '../../lib/api'

// Booking — two focused steps (p36 → p87→121):
//   1 · Services (search, multi-select, fee notice)   2 · Date & time (calendar grid, fit-checked slots, notes)
// A paid appointment holds its slot; slot starts that don't fit the visit length are unavailable.

const SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30']
const SLOT_SET = new Set(SLOTS)
const fmtSlot = (t) => t.replace(/^(\d+):(\d+)$/, (_, h, m) => `${((+h + 11) % 12) + 1}:${m} ${+h < 12 ? 'AM' : 'PM'}`)

export default function Book() {
  const { patientRecord } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [services, setServices] = useState([])
  const [prices, setPrices] = useState({})
  // draft survives Back/Forward/refresh (#44/#53); step lives in the URL so history is truthful (#43)
  const [picked, setPicked] = useStickyState('dv_book_picked', [])
  const [q, setQ] = useState('')
  const [date, setDate] = useStickyState('dv_book_date', '')
  const [time, setTime] = useStickyState('dv_book_time', '')
  const [notes, setNotes] = useStickyState('dv_book_notes', '')
  const [busyRanges, setBusyRanges] = useState([]) // [{start: Date, mins}] of paid visits
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // one catalog query + one exception query (was N+1: an exception query per service)
    Promise.all([
      listServices(),
      patientRecord?.id
        ? supabase.from('service_prices').select('service_id, price').eq('patient_id', patientRecord.id)
        : { data: [] },
    ]).then(async ([svcs, exc]) => {
      setServices(svcs)
      const overrides = Object.fromEntries((exc.data ?? []).map((x) => [x.service_id, x.price]))
      setPrices(Object.fromEntries(svcs.map((s) => [s.id, overrides[s.id] ?? s.price])))
    }).catch((e) => setErr(e.message))
  }, [patientRecord?.id])

  // paid visits for the chosen day (the only things that hold the chair)
  useEffect(() => {
    setBusyRanges([])
    setTime('')
    if (!date) return
    const from = new Date(`${date}T00:00:00`)
    const to = new Date(from.getTime() + 864e5)
    supabase.from('appointments')
      .select('scheduled_at, duration_minutes')
      .eq('payment_status', 'verified').neq('status', 'cancelled')
      .gte('scheduled_at', from.toISOString()).lt('scheduled_at', to.toISOString())
      .then(({ data }) => setBusyRanges((data ?? []).map((r) => ({ start: new Date(r.scheduled_at), mins: r.duration_minutes ?? 30 }))))
  }, [date])

  const urlStep = new URLSearchParams(location.search).get('step')
  const step = urlStep === '2' && picked.length ? 2 : 1 // clamp: step 2 needs a picked service
  const chosen = services.filter((s) => picked.includes(s.id))
  const total = chosen.reduce((sum, s) => sum + (prices[s.id] ?? s.price), 0)
  const visitMins = chosen.reduce((sum, s) => sum + (s.duration_minutes ?? 30), 0)
  const need = Math.max(1, Math.ceil(visitMins / 30))

  // a start fits when every 30-min half-hour it needs exists as a slot and none is held
  const fits = (t) => {
    const [h, m] = t.split(':').map(Number)
    for (let k = 0; k < need; k++) {
      const hh = h + Math.floor((m + k * 30) / 60)
      const mm = (m + k * 30) % 60
      const seg = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
      if (!SLOT_SET.has(seg)) return false
      const segStart = new Date(`${date}T${seg}:00`)
      const segEnd = new Date(segStart.getTime() + 30 * 60000)
      for (const b of busyRanges) {
        const bEnd = new Date(b.start.getTime() + b.mins * 60000)
        if (segStart < bEnd && b.start < segEnd) return false
      }
    }
    return true
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!patientRecord?.id) return setErr('No patient record linked to this account.')
    if (!picked.length || !date || !time) return setErr('Pick at least one service, a date, and a time.')
    setBusy(true)
    try {
      const appt = await bookAppointment({
        patientId: patientRecord.id,
        serviceId: picked[0],
        serviceIds: picked,
        requestedDate: date,
        scheduledAt: new Date(`${date}T${time}:00`).toISOString(),
        durationMinutes: visitMins,
        notes,
        price: total,
      })
      sessionStorage.removeItem('dv_book_picked'); sessionStorage.removeItem('dv_book_date')
      sessionStorage.removeItem('dv_book_time'); sessionStorage.removeItem('dv_book_notes')
      navigate('/book/confirm?appt=' + appt.id, { state: { appointment: { ...appt, price: total, services: { name: chosen.map((s) => s.name).join(' + ') } } } })
    } catch (ex) {
      setErr(/ux_appt_paid_slot|overlaps/.test(ex.message) ? 'That slot was just taken — pick another time.'
        : /ux_appt_patient_date/.test(ex.message) ? 'You already have a booking that day.'
        : /price does not match/.test(ex.message) ? 'Price changed — reload and try again.'
        : ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Book Appointment</h1>
        <p className="text-xs text-gray-500">Reservation &amp; Scheduling</p>
      </div>

      {/* step indicator */}
      <div className="flex items-center gap-2 text-xs font-semibold">
        {[['1', 'Services'], ['2', 'Date & time']].map(([n, label], i) => {
          const active = step === i + 1
          return (
            <span key={n} className="flex items-center gap-1.5">
              <span className={'w-6 h-6 rounded-full flex items-center justify-center ' + (active ? 'bg-primary-700 text-white' : 'bg-primary-100 text-primary-700')}>{n}</span>
              <span className={active ? 'text-gray-900' : 'text-gray-500'}>{label}</span>
              {i === 0 && <span className="w-6 border-t border-dashed border-gray-300" />}
            </span>
          )
        })}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {step === 1 && (
          <>
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Select dental service</h2>
              <div className="relative mb-2">
                <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search services…"
                       className="w-full h-10 border border-gray-200 rounded-lg pl-9 pr-3 text-sm bg-white placeholder:text-gray-500" />
              </div>
              <div className="space-y-2 pb-2">
                {services.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())).map((s) => {
                  const shown = prices[s.id] ?? s.price
                  const custom = shown !== s.price
                  const on = picked.includes(s.id)
                  return (
                    <button type="button" key={s.id} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                            aria-pressed={on}
                            className={'w-full text-left border rounded-lg px-3.5 py-2.5 flex items-center gap-3 ' + (on ? 'border-primary-600 bg-primary-100 ring-1 ring-primary-300' : 'bg-white border-gray-200')}>
                      <span className={'w-5 h-5 rounded border-2 flex-none flex items-center justify-center ' + (on ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300')}>
                        {on && <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-gray-900">{s.name}</span>
                        <span className="block text-xs text-gray-500">
                          {s.duration_minutes} min
                          {custom && <span className="ml-1 text-primary-700 font-semibold">· your price</span>}
                        </span>
                      </span>
                      <span className="text-sm font-bold text-gray-900 tabular-nums">{peso(shown)}</span>
                    </button>
                  )
                })}
                {!services.length && !err && <Skel lines={4} h="h-14" />}
              </div>
            </section>

          </>
        )}

        {step === 2 && (
          <>
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Selected services</h2>
              <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                {chosen.map((s) => (
                  <div key={s.id} className="flex justify-between px-3.5 py-2 text-sm">
                    <span className="font-semibold text-gray-900">{s.name} <span className="text-gray-500 font-normal">· {s.duration_minutes} min</span></span>
                    <span className="text-gray-600 tabular-nums">{peso(prices[s.id] ?? s.price)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-3.5 py-2 text-sm font-bold">
                  <span>Total appointment fee</span><span className="text-primary-700 tabular-nums">{peso(total)}</span>
                </div>
              </div>
            </section>

            <DateGrid date={date} setDate={setDate} />

            {date && (
              <section>
                <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">
                  Available time {visitMins > 30 && <span className="text-gray-500 normal-case font-normal">· needs {visitMins} min</span>}
                </h2>
                <div className="grid grid-cols-4 gap-2">
                  {SLOTS.map((t) => {
                    const ok = fits(t)
                    return (t === '13:00' ? <div key="lunch" className="col-span-4 text-[10px] text-gray-500 text-center py-0.5">— Lunch break · 12:00–1:00 —</div> : null) || (
                      <button type="button" key={t} disabled={!ok} onClick={() => setTime(t)}
                              className={'h-10 rounded-lg border text-xs font-semibold ' +
                                (!ok ? 'border-gray-100 bg-gray-50 text-gray-300'
                                  : time === t ? 'border-primary-600 bg-primary-50 text-primary-700'
                                  : 'border-gray-200 bg-white text-gray-700 hover:border-primary-300')}>
                        {fmtSlot(t)}
                      </button>
                    )
                  })}
                </div>
              </section>
            )}

            <label className="block">
              <span className="text-xs font-medium text-gray-500">Notes for the dentist (optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                        className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
            </label>
          </>
        )}

        {/* sticky action bar — fee context + CTA always in reach */}
        <div className="sticky -mx-4 px-4 pt-2 pb-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-0 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent">
        {step === 1 && (
          <p className="text-[11px] text-gray-500 bg-primary-50 border border-primary-100 rounded-lg px-3 py-2 mb-2">
            The appointment fee reserves your slot — it is <b>not</b> your full treatment bill. Any treatment is charged at the clinic.
          </p>
        )}
        {err && <p className="text-xs text-red-500 mb-2">{err}</p>}
        <div className="flex gap-2.5">
          {step === 2 && (
            <button type="button" onClick={() => navigate('/book')} className="w-[35%] h-12 rounded-lg border border-gray-200 bg-white text-gray-700 font-semibold">‹ Back</button>
          )}
          {step === 1 ? (
            <button type="button" disabled={!picked.length} onClick={() => { setErr(''); navigate('/book?step=2') }}
                    className="flex-1 h-12 rounded-lg bg-primary-600 text-white font-semibold disabled:bg-gray-200 disabled:text-gray-500">
              Next{total ? ` · ${peso(total)}` : ''}
            </button>
          ) : (
            <button disabled={busy || !date || !time} className="flex-1 h-12 rounded-lg bg-primary-600 text-white font-semibold disabled:bg-gray-200 disabled:text-gray-500">
              {busy ? 'Submitting…' : `Continue to Payment${total ? ' · ' + peso(total) : ''}`}
            </button>
          )}
        </div>
        </div>
      </form>
    </div>
  )
}

// Month-grid date picker (Figma p87: Monday-first month header + day grid)
function DateGrid({ date, setDate }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const monthName = month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  const firstDay = (month.getDay() + 6) % 7 // Monday-first (p87)
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const iso = (d) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const past = (d) => new Date(`${iso(d)}T00:00:00`) < today || new Date(`${iso(d)}T00:00:00`).getDay() === 0 // Sun closed
  const atEdge = (dir) => dir < 0
    ? month <= new Date(today.getFullYear(), today.getMonth(), 1)
    : month >= new Date(today.getFullYear(), today.getMonth() + 2, 1)
  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Preferred date</h2>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous month" disabled={atEdge(-1)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40">‹</button>
          <span className="text-sm font-bold text-gray-900 w-36 text-center">{monthName}</span>
          <button type="button" aria-label="Next month" disabled={atEdge(1)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40">›</button>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-2">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-gray-500 mb-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <span key={'e' + i} />
            const sel = date === iso(d)
            const t0 = new Date(); const isToday = iso(d) === `${t0.getFullYear()}-${String(t0.getMonth() + 1).padStart(2, '0')}-${String(t0.getDate()).padStart(2, '0')}`
            return (
              <button type="button" key={d} disabled={past(d)} onClick={() => setDate(iso(d))}
                      className={'h-11 rounded-lg text-sm font-semibold ' +
                        (past(d) ? 'text-gray-300'
                          : sel ? 'bg-primary-600 text-white'
                          : 'text-gray-700 hover:bg-primary-50 ' + (isToday ? 'ring-1 ring-primary-400' : ''))}>
                {d}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}
