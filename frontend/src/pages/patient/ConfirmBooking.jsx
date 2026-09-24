import { useLocation, useNavigate } from 'react-router-dom'
import { peso } from '../../lib/api'

// Confirm Your Appointment (p121): summary + Pay Now → QR flow
export default function ConfirmBooking() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const appt = state?.appointment

  if (!appt) return (
    <div className="px-4 py-16 text-center">
      <p className="text-sm text-gray-500">Missing appointment.</p>
      <button onClick={() => navigate('/book')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">Book Again</button>
    </div>
  )

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
        <p className="text-xs text-gray-500 mt-1">Pay the appointment fee to reserve your slot — treatment charges are billed at the clinic.</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-none">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2.5C9.4 2.5 7.5 4.6 7.5 7.2c0 1.7.5 3.1 1.1 4.6.5 1.2 1 2.5 1.3 3.9.2 1 .4 1.9.4 2.4 0 1.4.8 2.4 1.7 2.4s1.7-1 1.7-2.4c0-.5.2-1.4.4-2.4.3-1.4.8-2.7 1.3-3.9.6-1.5 1.1-2.9 1.1-4.6C16.5 4.6 14.6 2.5 12 2.5z" /></svg>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Selected service</div>
          <div className="text-sm font-bold text-gray-900">{appt.services?.name ?? 'Service'}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary-50 text-primary-600 flex items-center justify-center flex-none">
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 5h18v16H3zM3 10h18M8 3v4M16 3v4" /></svg>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Scheduled date &amp; time</div>
          <div className="text-sm font-bold text-gray-900">{dateStr}</div>
          <div className="text-xs text-gray-500">{dayStr}</div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-sm font-bold text-gray-900 mb-2">Appointment fee</div>
        <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
          <span className="text-gray-600">Appointment fee</span><span className="font-bold text-gray-900">{peso(appt.price ?? 0)}</span>
        </div>
        <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
          <span className="text-gray-600">Admin</span><span className="font-bold text-green-600">Free</span>
        </div>
      </div>

      <div className="flex gap-2.5">
        <button onClick={() => history.back()} className="w-[40%] h-11 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold bg-white">‹ Back</button>
        <button onClick={() => navigate('/pay/qr', { state: { appointment: appt } })} className="flex-1 h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">Pay Now</button>
      </div>
    </div>
  )
}

// Booking success (p131)
export function BookSuccess() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const appt = state?.appointment
  const dt = appt?.requested_date ? new Date(appt.requested_date + 'T00:00:00') : null

  return (
    <div className="px-4 py-8 space-y-4">
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-green-100 text-green-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-3">You have successfully made an appointment</h1>
        <p className="text-xs text-gray-500 mt-1">The appointment confirmation has been sent to your email.</p>
      </div>

      {appt && (
        <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2.5">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Selected service</div>
            <div className="text-sm font-bold text-gray-900">{appt.services?.name ?? 'Service'}</div>
          </div>
          <div className="border-t border-gray-100 pt-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Scheduled date &amp; time</div>
            <div className="text-sm font-bold text-gray-900">{dt ? dt.toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div>
          </div>
        </div>
      )}

      <button onClick={() => navigate('/appointments')} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold">View My Appointments</button>
      <button onClick={() => navigate('/')} className="w-full h-11 rounded-lg border border-gray-200 text-gray-700 text-sm font-semibold bg-white">Back to Home</button>
    </div>
  )
}
