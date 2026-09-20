import { useEffect, useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { listServices, bookAppointment, peso, getEffectivePrice } from '../../lib/api'

// Patient booking: pick service → date → notes → submit.
// The price shown is the patient's EFFECTIVE price (custom exception if set).

export default function Book() {
  const { patientRecord } = useAuth()
  const [services, setServices] = useState([])
  const [prices, setPrices] = useState({}) // serviceId → effective price
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    listServices()
      .then(async (svcs) => {
        setServices(svcs)
        if (!patientRecord?.id) return
        // resolve custom-price exceptions per patient
        const entries = await Promise.all(
          svcs.map(async (s) => [s.id, await getEffectivePrice(patientRecord.id, s.id, s.price)]),
        )
        setPrices(Object.fromEntries(entries))
      })
      .catch((e) => setErr(e.message))
  }, [patientRecord?.id])

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (!patientRecord?.id) return setErr('No patient record linked to this account.')
    if (!serviceId || !date) return setErr('Pick a service and a date.')
    setBusy(true)
    try {
      await bookAppointment({
        patientId: patientRecord.id,
        serviceId,
        requestedDate: date,
        notes,
        price: prices[serviceId] ?? services.find((s) => s.id === serviceId)?.price,
      })
      setDone(true)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-3">Booking Request Submitted</h1>
        <p className="text-xs text-gray-500 mt-1">The dentist will assign your exact time — you'll see it in My Appointments.</p>
        <button onClick={() => window.location.assign('#/appointments')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">My Appointments</button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Book Appointment</h1>
        <p className="text-xs text-gray-500">Reservation &amp; scheduling</p>
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

        <label className="block">
          <span className="text-xs font-medium text-gray-500">Preferred date</span>
          <input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)}
                 className="mt-1 w-full h-11 border border-gray-200 rounded-lg px-3 text-sm bg-white" />
        </label>

        <label className="block">
          <span className="text-xs font-medium text-gray-500">Notes for the dentist (optional)</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                    className="mt-1 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white" />
        </label>

        {err && <p className="text-xs text-red-500">{err}</p>}
        <button disabled={busy} className="w-full h-12 rounded-lg bg-primary-600 text-white font-semibold disabled:opacity-60">
          {busy ? 'Submitting…' : 'Submit Booking Request'}
        </button>
      </form>
    </div>
  )
}
