import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase, peso } from '../../lib/api'

// Receipt (p94): patient attaches an optional receipt image to a completed visit
export default function Receipt() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const appt = state?.appointment
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  if (!appt) return (
    <div className="px-4 py-16 text-center">
      <p className="text-sm text-gray-500">No completed visit selected.</p>
      <button onClick={() => navigate('/appointments')} className="mt-4 h-10 px-4 rounded-lg bg-primary-600 text-white text-sm font-semibold">My Appointments</button>
    </div>
  )

  const pick = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!['image/png', 'image/jpeg'].includes(f.type)) return setErr('PNG or JPG only.')
    if (f.size > 5 * 1024 * 1024) return setErr('Max file size is 5 MB.')
    setErr('')
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  const attach = async () => {
    if (!file) return setErr('Choose an image first.')
    setBusy(true)
    setErr('')
    const reader = new FileReader()
    reader.onload = async () => {
      const { error } = await supabase.from('payment_proofs').insert({ appointment_id: appt.id, image: reader.result })
      setBusy(false)
      if (error) return setErr(error.message)
      setSaved(true)
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Receipt</h1>
        <p className="text-xs text-gray-500">Optional attachment</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">Completed visit</div>
        <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
          <span className="text-gray-600">Service</span><span className="font-bold text-gray-900">{appt.services?.name ?? 'Service'}</span>
        </div>
        <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
          <span className="text-gray-600">Amount paid</span><span className="font-bold text-gray-900">{peso(appt.price ?? 0)}</span>
        </div>
        <div className="flex justify-between text-sm py-1.5 border-t border-gray-100">
          <span className="text-gray-600">Status</span><span className="font-bold text-primary-600">Completed</span>
        </div>
      </div>

      {saved ? (
        <div className="bg-green-50 border border-green-100 rounded-lg p-4 text-center text-sm font-semibold text-green-700">Receipt attached ✓</div>
      ) : (
        <>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-gray-500 mb-2">Attach your receipt (optional)</div>
            <label className="block border-2 border-dashed border-gray-200 rounded-lg bg-gray-50 py-6 text-center cursor-pointer">
              {preview ? (
                <img src={preview} alt="Receipt preview" className="max-h-40 mx-auto rounded" />
              ) : (
                <>
                  <div className="w-9 h-9 mx-auto rounded-full bg-primary-600 text-white flex items-center justify-center text-lg font-bold">+</div>
                  <div className="text-sm font-semibold text-gray-800 mt-2">Tap to attach your receipt</div>
                  <div className="text-[11px] text-gray-500">PNG or JPG · max 5 MB</div>
                </>
              )}
              <input type="file" accept="image/png,image/jpeg" onChange={pick} className="hidden" />
            </label>
          </div>
          <button onClick={attach} disabled={busy} className="w-full h-11 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-60">
            {busy ? 'Uploading…' : 'Attach Receipt'}
          </button>
        </>
      )}
      {err && <p className="text-xs text-red-500">{err}</p>}

      <div className="bg-primary-50 border border-primary-100 rounded-lg px-3.5 py-2.5 text-[11px] text-primary-800">
        ⓘ Payments are recorded at the clinic when your visit is completed — attaching a receipt is optional.
      </div>
    </div>
  )
}
