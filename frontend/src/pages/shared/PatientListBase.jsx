import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listPatients } from '../../lib/api'
import { useAuth } from '../../context/RoleContext'

// Patient list for staff — tap a row to open the chat thread.

export default function PatientListBase({ title, subtitle }) {
  const [patients, setPatients] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const navigate = useNavigate()
  const { profile } = useAuth()
  const roleBase = profile?.role === 'patient' ? '' : '/' + profile?.role

  useEffect(() => {
    listPatients().then(setPatients).catch((e) => setErr(e.message))
  }, [])

  const filtered = (patients ?? []).filter((p) => p.full_name?.toLowerCase().includes(q.toLowerCase()))

  const openChat = (p) => navigate(roleBase + '/messages', { state: { patient: p } })

  return (
    <div className="px-4 py-4 space-y-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name…"
             className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />

      {err && <p className="text-xs text-red-500">{err}</p>}
      {!patients && <p className="text-sm text-gray-400">Loading…</p>}
      {patients && filtered.length === 0 && <p className="text-sm text-gray-400 py-6 text-center">No patients found.</p>}

      <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
        {filtered.map((p) => (
          <button key={p.id} onClick={() => openChat(p)} className="w-full flex items-center gap-3 px-3.5 py-3 text-left">
            <span className="w-10 h-10 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center flex-none">
              {(p.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-gray-900 truncate">{p.full_name}</span>
              <span className="block text-xs text-gray-500">{p.email || p.phone || 'No contact info'}</span>
            </span>
            <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-400 flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400 text-center pb-20 pr-14">Tap a patient to open the chat thread.</p>
    </div>
  )
}
