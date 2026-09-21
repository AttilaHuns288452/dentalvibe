import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../../supabaseClient'
import { peso } from '../../lib/format'

// Payment-before-confirmation: patient uploads payment proof after booking.
// Appointment stays pending until the clinic verifies the proof.

export default function Payment() {
  const { state } = useLocation()
  const appt = state?.appointment
  const navigate = useNavigate()
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  if (!appt) {
    return (
      <div className="px-4 py-16 text-center">
        <h1 className="text-lg font-bold text-gray-900">Payment</h1>
        <p className="text-xs text-gray-500 mt-1">Open this page right after booking.</p>
        <button onClick={() => navigate('/appointments')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">My Appointments</button>
      </div>
    )
  }

  const pick = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 5 * 1024 * 1024) return setErr('Image must be under 5 MB.')
    if (!f.type.startsWith('image/')) return setErr('Upload an image (JPG/PNG).')
    setErr('')
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const submit = async () => {
    if (!file) return setErr('Attach your payment proof first.')
    if (file.size > 2 * 1024 * 1024) return setErr('Image too large — max 2MB.')
    setBusy(true)
    setErr('')
    try {
      const reader = new FileReader()
      const dataUrl = await new Promise((res, rej) => {
        reader.onload = () => res(reader.result)
        reader.onerror = rej
        reader.readAsDataURL(file)
      })
      // ponytail: base64 data-URL in a table (no storage bucket needed); 2MB cap enforced by fn_submit_payment_proof
      const { error } = await supabase.rpc('fn_submit_payment_proof', { p_appointment: appt.id, p_image: dataUrl })
      if (error) throw error
      setDone(true)
    } catch (ex) {
      setErr(ex.message)
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="px-4 py-16 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 text-primary-600 flex items-center justify-center">
          <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-3">Payment Proof Submitted</h1>
        <p className="text-xs text-gray-500 mt-1">The clinic will verify your payment. Your appointment will be confirmed once verified.</p>
        <button onClick={() => navigate('/appointments')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">My Appointments</button>
      </div>
    )
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Payment</h1>
        <p className="text-xs text-gray-500">Upload proof to confirm your booking</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">{appt.services?.name}</span>
          <span className="font-bold text-gray-900">{peso(appt.price ?? appt.services?.price)}</span>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>Requested: {appt.requested_date}</span>
          <span>Ref: {appt.id.slice(0, 8).toUpperCase()}</span>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-100 rounded-lg p-3.5 text-xs text-amber-800">
        <b>GCash / Bank transfer</b> — pay the exact amount, then upload a screenshot of your receipt below. The clinic verifies it before confirming your appointment.
      </div>

      <label className="block">
        <span className="text-xs font-medium text-gray-500">Payment proof (screenshot)</span>
        {preview ? (
          <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
            <img src={preview} alt="Payment proof preview" className="w-full max-h-64 object-contain bg-gray-50" />
            <button type="button" onClick={() => { setFile(null); setPreview(null) }} className="w-full py-2 text-xs text-red-500 font-semibold bg-white">Remove</button>
          </div>
        ) : (
          <div className="mt-1 border-2 border-dashed border-gray-200 rounded-lg py-8 text-center cursor-pointer hover:border-primary-300">
            <input type="file" accept="image/*" onChange={pick} className="hidden" id="proofInput" />
            <label htmlFor="proofInput" className="text-sm text-gray-500">
              <span className="block text-2xl mb-1">📷</span>
              Tap to attach receipt
            </label>
          </div>
        )}
      </label>

      {err && <p className="text-xs text-red-500">{err}</p>}
      <button onClick={submit} disabled={busy || !file}
              className="w-full h-12 rounded-lg bg-primary-600 text-white font-semibold disabled:opacity-50">
        {busy ? 'Uploading…' : 'Submit Payment Proof'}
      </button>
      <button onClick={() => navigate('/appointments')} className="w-full h-10 text-xs text-gray-400">Skip for now — pay later</button>
    </div>
  )
}
