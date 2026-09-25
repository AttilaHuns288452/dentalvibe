import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { peso, supabase } from '../../lib/api'

// Confirm Your Appointment (p121): summary + Pay Now → QR flow
// state is a cache, ?appt=<id> is the truth — refresh/deep links revalidate (#44/#47)
export default function ConfirmBooking() {
  const { state, search } = useLocation()
  const navigate = useNavigate()
  const id = new URLSearchParams(search).get('appt')
  const [fetched, setFetched] = useState(state?.appointment || null)
  const [gone, setGone] = useState(false)
  const appt = fetched

  useEffect(() => {
    if (fetched || !id) return
    supabase.from('appointments')
      .select('id, price, requested_date, scheduled_at, status, payment_status, services(name)')
      .eq('id', id).maybeSingle()
      .then(({ data }) => (data ? setFetched(data) : setGone(true)))
      .catch(() => setGone(true))
  }, [id, fetched])

  if (!appt) return (
    <div className="px-4 py-16 text-center">
      {gone ? (
        <>
          <p className="text-sm text-gray-500">This appointment no longer exists.</p>
          <button onClick={() => navigate('/book')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Book Again</button>
        </>
      ) : id ? (
        <p className="text-sm text-gray-500 animate-pulse">Loading appointment…</p>
      ) : (
        <>
          <p className="text-sm text-gray-500">Missing appointment.</p>
          <button onClick={() => navigate('/book')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Book Again</button>
        </>
      )}
    </div>
  )

  if (appt.payment_status === 'paid' || appt.status === 'approved') {
    navigate('/book/success?appt=' + appt.id, { replace: true, state: { appointment: appt } })
    return null
  }

  const dt = new Date(appt.requested_date + 'T00:00:00')
  const dateStr = dt.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })
  const dayStr = dt.toLocaleDateString('en-PH', { weekday: 'long' })

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="text-center pt-2">
        <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-3">Confirm Your Appointment</h1>
        <p className="text-xs text-gray-500 mt-1">Pay for your selected service(s) to confirm your appointment.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-none">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" /></svg>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Selected service</div>
          <div className="text-sm font-bold text-gray-900">{appt.services?.name ?? 'Service'}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-none">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" /></svg>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Scheduled date &amp; time</div>
          <div className="text-sm font-bold text-gray-900">{dateStr}</div>
          <div className="text-xs text-gray-500">{dayStr}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm font-bold text-gray-900 mb-2">Payment summary</div>
        <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
          <span className="text-gray-600">Services</span><span className="font-bold text-gray-900">{peso(appt.price ?? 0)}</span>
        </div>
        <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
          <span className="text-gray-600">Admin</span><span className="font-bold text-green-600">Free</span>
        </div>
      </div>

      <div className="flex gap-2.5">
        <button onClick={() => history.back()} className="w-[40%] h-11 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold bg-white">‹ Back</button>
        <button onClick={() => navigate('/pay/qr?appt=' + appt.id, { state: { appointment: appt } })} className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">Pay Now</button>
      </div>
    </div>
  )
}

// Booking success (p131) — authoritative result screen (#54): refresh/reopen shows
// the REAL appointment state and never offers a second payment.
export function BookSuccess() {
  const { state, search } = useLocation()
  const navigate = useNavigate()
  const id = new URLSearchParams(search).get('appt')
  const [appt, setAppt] = useState(state?.appointment?.payment_status ? state.appointment : null)
  const [gone, setGone] = useState(false)

  useEffect(() => {
    if (!id) return
    // the provider webhook settles in the background — keep re-reading until confirmed
    let stop = false
    const load = async () => {
      const { data } = await supabase.from('appointments')
        .select('id, price, requested_date, scheduled_at, status, payment_status, services(name)')
        .eq('id', id).maybeSingle().then((r) => r).catch(() => ({ data: null }))
      if (stop) return
      if (data) {
        setAppt(data)
        if (data.payment_status === 'paid' || data.status === 'approved') clearInterval(t)
      } else setGone(true)
    }
    const t = setInterval(load, 4000)
    load()
    return () => { stop = true; clearInterval(t) }
  }, [id])
  const dt = appt?.requested_date ? new Date(appt.requested_date + 'T00:00:00') : null

  if (!appt) return (
    <div className="px-4 py-16 text-center">
      {gone
        ? <p className="text-sm text-gray-500">This appointment no longer exists.</p>
        : id ? <p className="text-sm text-gray-500 animate-pulse">Checking your appointment…</p>
        : <p className="text-sm text-gray-500">Missing appointment.</p>}
      <button onClick={() => navigate('/appointments')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">My Appointments</button>
    </div>
  )

  const confirmed = appt.payment_status === 'paid' || appt.status === 'approved'
  return (
    <div className="px-4 py-8 space-y-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-3">{confirmed ? 'Appointment confirmed' : 'Appointment booked'}</h1>
        <p className="text-xs text-gray-500 mt-1">{confirmed
          ? 'Your appointment is confirmed and fully paid — arrive 10 minutes early.'
          : appt.payment_status === 'pending'
            ? 'Waiting for payment confirmation.'
            : 'Pay for your appointment to confirm it.'}</p>
      </div>

      {appt && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Selected service</div>
            <div className="text-sm font-bold text-gray-900">{appt.services?.name ?? 'Service'}</div>
          </div>
          <div className="border-t border-gray-100 pt-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Scheduled date &amp; time</div>
            <div className="text-sm font-bold text-gray-900">{dt ? dt.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
          </div>
        </div>
      )}

      {!confirmed && (
        <button onClick={() => navigate('/pay/qr?appt=' + appt.id, { state: { appointment: appt } })} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">Continue to payment</button>
      )}
      <button onClick={() => navigate('/appointments')} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">View My Appointments</button>
      <button onClick={() => navigate('/')} className="w-full h-11 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold bg-white">Back to Home</button>
    </div>
  )
}
