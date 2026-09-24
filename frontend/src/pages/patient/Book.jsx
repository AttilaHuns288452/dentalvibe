import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/RoleContext'
import { listServices, bookAppointment, peso, getEffectivePrice, supabase } from '../../lib/api'

// Patient booking (video flow): pick services → date → time → payment summary → QR → confirmed.
// The price shown is the patient's EFFECTIVE price (custom exception if set).
// A PAID appointment holds its slot; unpaid bookings hold nothing (video: "the slot is secured
// the moment payment lands").

// Month-grid date picker (Figma p87: month header + day grid)
function DateGrid({ date, setDate }) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const monthName = month.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
  const firstDay = (month.getDay() + 6) % 7 // Monday-first (p87)
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const iso = (d) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  const past = (d) => new Date(`${iso(d)}T00:00:00`) < today
  const atEdge = (dir) => dir < 0
    ? month <= new Date(today.getFullYear(), today.getMonth(), 1)
    : month >= new Date(today.getFullYear(), today.getMonth() + 2, 1)
  return (
    <section>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Preferred date</h2>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Previous month" disabled={atEdge(-1)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
                  className="w-7 h-7 rounded border border-gray-200 bg-white text-gray-500 disabled:opacity-40">‹</button>
          <span className="text-sm font-bold text-gray-900 w-36 text-center">{monthName}</span>
          <button type="button" aria-label="Next month" disabled={atEdge(1)} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
                  className="w-7 h-7 rounded border border-gray-200 bg-white text-gray-500 disabled:opacity-40">›</button>
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-2">
        <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-gray-400 mb-1">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <span key={'e' + i} />
            const sel = date === iso(d)
            return (
              <button type="button" key={d} disabled={past(d)} onClick={() => setDate(iso(d))}
                      className={'h-9 rounded-lg text-sm font-semibold ' +
                        (past(d) ? 'text-gray-300'
                          : sel ? 'bg-primary-600 text-white'
                          : 'text-gray-700 hover:bg-primary-50')}>
                {d}
              </button>
            )
          })}
        </div>
      </div>
    </section>
  )
}

const SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30']

export default function Book() {
  const { patientRecord } = useAuth()
  const navigate = useNavigate()
  const [services, setServices] = useState([])
  const [prices, setPrices] = useState({})
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [taken, setTaken] = useState([])
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listServices()
      .then(async (svcs) => {
        setServices(svcs)
        if (!patientRecord?.id) return
        const entries = await Promise.all(
          svcs.map(async (s) => [s.id, await getEffectivePrice(patientRecord.id, s.id, s.price)]),
        )
        setPrices(Object.fromEntries(entries))
      })
      .catch((e) => setErr(e.message))
  }, [patientRecord?.id])

  // slots already secured (paid) for the chosen date
  useEffect(() => {
    setTaken([])
    setTime('')
    if (!date) return
    const from = new Date(`${date}T00:00:00`)
    const to = new Date(from.getTime() + 864e5)
    supabase.from('appointments')
      .select('scheduled_at')
      .eq('payment_status', 'verified')
      .gte('scheduled_at', from.toISOString()).lt('scheduled_at', to.toISOString())
      .then(({ data }) => setTaken((data ?? []).map((r) => new Date(r.scheduled_at))))
  }, [date])

  const takenStr = taken.map((d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!patientRecord?.id) return setErr('No patient record linked to this account.')
    if (!serviceId || !date || !time) return setErr('Pick a service, a date, and a time.')
    setBusy(true)
    try {
      const appt = await bookAppointment({
        patientId: patientRecord.id,
        serviceId,
        requestedDate: date,
        scheduledAt: new Date(`${date}T${time}:00`).toISOString(),
        notes,
        price: prices[serviceId] ?? services.find((s) => s.id === serviceId)?.price,
      })
      navigate('/book/confirm', { state: { appointment: { ...appt, services: { name: services.find((s) => s.id === serviceId)?.name } } } })
    } catch (ex) {
      setErr(/ux_appt_paid_slot/.test(ex.message) ? 'That slot was just taken — pick another time.'
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

      <form onSubmit={submit} className="space-y-4">
        <section>
          <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Select dental service</h2>
          <div className="space-y-2">
            {services.map((s) => {
              const shown = prices[s.id] ?? s.price
              const custom = shown !== s.price
              return (
                <button type="button" key={s.id} onClick={() => setServiceId(s.id)}
                        className={'w-full text-left bg-white border rounded-lg px-3.5 py-2.5 flex items-center gap-3 ' + (serviceId === s.id ? 'border-primary-600 bg-primary-50' : 'border-gray-200')}>
                  <span className={'w-4 h-4 rounded-full border-2 flex-none ' + (serviceId === s.id ? 'border-primary-600 bg-primary-600' : 'border-gray-300')} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-gray-900">{s.name}</span>
                    <span className="block text-xs text-gray-500">
                      {s.duration_minutes} min
                      {custom && <span className="ml-1 text-primary-700 font-semibold">· your price</span>}
                    </span>
                  </span>
                  <span className="text-sm font-bold text-gray-900">{peso(shown)}</span>
                </button>
              )
            })}
            {!services.length && !err && <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-3 text-sm text-gray-400">Loading services…</div>}
          </div>
        </section>

        <DateGrid date={date} setDate={setDate} />

        {date && (
          <section>
            <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Available time</h2>
            <div className="grid grid-cols-4 gap-2">
              {SLOTS.map((t) => {
                const gone = takenStr.includes(t)
                return (
                  <button type="button" key={t} disabled={gone} onClick={() => setTime(t)}
                          className={'h-10 rounded-lg border text-xs font-semibold ' +
                            (gone ? 'border-gray-100 bg-gray-50 text-gray-300 line-through'
                              : time === t ? 'border-primary-600 bg-primary-50 text-primary-700'
                              : 'border-gray-200 bg-white text-gray-700')}>
                    {t.replace(/^(\d+):(\d+)$/, (_, h, m) => `${((+h + 11) % 12) + 1}:${m} ${+h < 12 ? 'AM' : 'PM'}`)}
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

        {err && <p className="text-xs text-red-500">{err}</p>}
        <button disabled={busy} className="w-full h-12 rounded-lg bg-primary-600 text-white font-semibold disabled:opacity-60">
          {busy ? 'Submitting…' : 'Continue to Payment'}
        </button>
      </form>
    </div>
  )
}
