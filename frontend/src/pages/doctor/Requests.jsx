import { useEffect, useState } from 'react'
import { useAuth } from '../../context/RoleContext'
import { listAppointments, setAppointmentStatus, peso, supabase } from '../../lib/api'
import { fmtTime12 } from '../../lib/format'

// Booking review — Figma frames 12/32/64: approve (gated on payment), decline,
// verify payment proof, mark completed.

const STATUS_PILL = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  completed: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-600',
}

function ProofModal({ apptId, onClose }) {
  const [proofs, setProofs] = useState(null)
  useEffect(() => {
    supabase.from('payment_proofs').select('*').eq('appointment_id', apptId).order('created_at')
      .then(({ data }) => setProofs(data ?? []))
  }, [apptId])
  return (
    <div className="fixed inset-0 bg-gray-900/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-4 max-w-sm w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-sm font-bold text-gray-900">Payment proof</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 text-lg leading-none">×</button>
        </div>
        {!proofs && <p className="text-sm text-gray-400">Loading…</p>}
        {proofs?.length === 0 && <p className="text-sm text-gray-400">No proof uploaded.</p>}
        {(proofs ?? []).map((p) => (
          <img key={p.id} src={p.image} alt="Payment proof" className="w-full rounded-lg border border-gray-100 mb-2" />
        ))}
      </div>
    </div>
  )
}

export default function Requests() {
  const [appts, setAppts] = useState(null)
  const [err, setErr] = useState('')
  const [assigning, setAssigning] = useState(null)
  const [when, setWhen] = useState('')
  const [proofFor, setProofFor] = useState(null)

  const load = () => listAppointments().then(setAppts).catch((e) => setErr(e.message))
  useEffect(load, [])

  const act = async (id, status, extra = {}) => {
    try {
      await setAppointmentStatus(id, status, extra)
      setAssigning(null)
      load()
    } catch (ex) {
      setErr(ex.message)
    }
  }

  const pending = (appts ?? []).filter((a) => a.status === 'pending')
  const rest = (appts ?? []).filter((a) => a.status !== 'pending')

  return (
    <div className="px-4 py-4 space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Requests</h1>
        <p className="text-xs text-gray-500">Booking review · payment verification</p>
      </div>
      {err && <p className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}

      <section>
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-500 mb-1.5">Pending ({pending.length})</h2>
        {!appts && <p className="text-sm text-gray-400">Loading…</p>}
        {appts && pending.length === 0 && <p className="text-sm text-gray-400 px-1">No pending requests.</p>}
        <div className="space-y-2">
          {pending.map((a) => (
            <div key={a.id} className="bg-white border border-gray-200 rounded-lg p-3.5 space-y-2">
              <div className="flex items-center gap-2">
                <div className="flex-1 text-sm font-bold text-gray-900">{a.patients?.full_name || 'Patient'}</div>
                <span className={'text-[11px] font-bold px-2 py-0.5 rounded ' + (a.payment_status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500')}>
                  {a.payment_status === 'submitted' ? 'Proof submitted ✓' : 'Unpaid'}
                </span>
              </div>
              <div className="text-xs text-gray-500">{a.services?.name} · requested {a.requested_date} · {peso(a.price ?? a.services?.price)}</div>
              {a.notes && <div className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5 italic">"{a.notes}"</div>}

              {a.payment_status === 'submitted' && (
                <button onClick={() => setProofFor(a.id)} className="text-xs font-semibold text-primary-700 underline">
                  View payment proof
                </button>
              )}

              {assigning === a.id ? (
                <div className="flex gap-2 items-center pt-1">
                  <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                         className="flex-1 h-9 border border-gray-200 rounded-lg px-2 text-xs" />
                  <button onClick={() => act(a.id, 'approved', { scheduled_at: when })} disabled={!when}
                          className="h-9 px-3 rounded-lg bg-primary-600 text-white text-xs font-semibold disabled:opacity-50">Confirm</button>
                  <button onClick={() => setAssigning(null)} className="h-9 px-3 rounded-lg border border-gray-200 text-xs text-gray-500">Cancel</button>
                </div>
              ) : (
                <div className="flex gap-2 pt-1">
                  <button onClick={() => { setAssigning(a.id); setWhen('') }}
                          className="flex-1 h-9 rounded-lg bg-primary-600 text-white text-xs font-semibold">
                    {a.payment_status === 'submitted' ? 'Verify & Approve' : 'Approve'}
                  </button>
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
          {rest.map((a) => (
            <div key={a.id} className="bg-white border border-gray-200 rounded-lg px-3.5 py-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 text-sm font-semibold text-gray-900">{a.patients?.full_name}</div>
                <span className={'text-[11px] font-bold px-2 py-0.5 rounded capitalize ' + (STATUS_PILL[a.status] || '')}>{a.status}</span>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">
                {a.services?.name} · {a.scheduled_at ? `${new Date(a.scheduled_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${fmtTime12(a.scheduled_at.slice(11, 16))}` : a.requested_date}
                {` · ${peso(a.price ?? a.services?.price)}`}
              </div>
              {a.status === 'approved' && (
                <div className="flex gap-2 mt-2">
                  {a.payment_status === 'submitted' && (
                    <button onClick={() => setProofFor(a.id)} className="h-8 px-3 rounded-lg border border-blue-200 text-blue-600 text-xs font-semibold bg-white">Verify payment</button>
                  )}
                  <button onClick={() => act(a.id, 'completed')} className="h-8 px-3 rounded-lg bg-blue-600 text-white text-xs font-semibold">Mark Completed</button>
                </div>
              )}
            </div>
          ))}
          {appts && rest.length === 0 && <p className="text-sm text-gray-400 px-1">Nothing scheduled yet.</p>}
        </div>
      </section>

      {proofFor && <ProofModal apptId={proofFor} onClose={() => { setProofFor(null); load() }} />}
    </div>
  )
}
