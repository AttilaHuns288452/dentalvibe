import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listAudit } from '../../lib/finance'
import Skel from '../../components/Skel'

// Owner audit log — chronological, WHO / WHAT / WHEN with before→after summary.
// ponytail: one fetch of the latest 200 rows, filters applied client-side.

const fmt = (v) => (v === null || v === undefined ? '—' : String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 60))
const pick = (o) => Object.entries(o ?? {})
  .filter(([k, v]) => v != null && !['id', 'created_at', 'updated_at'].includes(k))
  .slice(0, 3).map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')

// readable diff: 'amount 800 to 900' · 'full_name Maria to Maria S.'
function summarize(r) {
  const b = r.before_data, a = r.after_data
  if (a?.voided) return `voided (was amount ${fmt(b?.amount)})`
  if (!b && !a) return r.detail ? JSON.stringify(r.detail) : ''
  if (!b) return 'created · ' + pick(a)
  if (!a) return 'removed · ' + pick(b)
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
  const changes = keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => (k in b && k in a ? `${k} ${fmt(b[k])} to ${fmt(a[k])}` : k in b ? `${k} ${fmt(b[k])} to —` : `${k} — to ${fmt(a[k])}`))
  return changes.join(' · ')
}

// human-readable line for an audit row (§12: WHO did WHAT) — keeps raw
// action/entity for filters, describes the change itself
function describe(r) {
  const b = r.before_data ?? {}
  const a = r.after_data ?? {}
  const who = (o) => o.full_name || o.name || o.patient_name || o.clinic_name || r.entity_id?.slice(0, 8) || ''
  if (r.entity === 'dentists') {
    if (r.action === 'INSERT') return `Added dentist ${who(a)}`
    if (b.active === true && a.active === false) return `Deactivated ${who(a) || who(b)}`
    if (b.active === false && a.active === true) return `Reactivated ${who(a) || who(b)}`
    return `Updated dentist ${who(a) || who(b)}`
  }
  if (r.entity === 'services') {
    if (r.action === 'INSERT') return `Added service ${who(a)}`
    if (b.price !== a.price && a.price !== undefined) return `Changed service price · ${who(a) || who(b)} · ₱${fmt(b.price)} → ₱${fmt(a.price)}`
    if (b.active === true && a.active === false) return `Deactivated service ${who(a) || who(b)}`
    if (b.active === false && a.active === true) return `Activated service ${who(a) || who(b)}`
    return `Updated service ${who(a) || who(b)}`
  }
  if (r.entity === 'service_prices') return `Changed patient-specific price · ₱${fmt(b.price)} → ₱${fmt(a.price)}`
  if (r.entity === 'transactions') {
    if (r.action === 'CORRECT') return `Corrected transaction · ${who(a) || who(b)} · ₱${fmt(b.amount)} → ₱${fmt(a.amount)}`
    if (r.action === 'VOID') return `Voided transaction · ${who(a) || who(b)}`
    return `${r.action === 'INSERT' ? 'Recorded' : 'Updated'} transaction · ${who(a) || who(b)}`
  }
  if (r.entity === 'clinic_settings') {
    const fields = Object.keys({ ...b, ...a }).filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]) && k !== 'id')
    return `Updated clinic settings (${fields.join(', ') || 'no visible change'})`
  }
  if (r.entity === 'ehr_attachments') return r.action === 'DELETE' ? 'Deleted EHR attachment' : r.action === 'INSERT' ? 'Uploaded EHR attachment' : 'Updated EHR attachment'
  if (r.entity === 'record_categories') return `${r.action === 'INSERT' ? 'Added' : r.action === 'DELETE' ? 'Removed' : 'Updated'} record category`
  if (r.entity === 'patients') return 'Updated patient record'
  return `${r.action} ${r.entity}`
}

export default function OwnerAudit() {
  const navigate = useNavigate()
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [action, setAction] = useState('')
  const [entity, setEntity] = useState('')
  const [actor, setActor] = useState('')

  const load = () => {
    setErr('')
    listAudit().then(setRows).catch((e) => setErr(e.message))
  }
  useEffect(load, [])

  const shown = useMemo(() => (rows ?? []).filter((r) =>
    (!action || r.action === action) &&
    (!entity || r.entity === entity) &&
    (!actor || `${r.actor_name} ${r.actor_role ?? ''}`.toLowerCase().includes(actor.toLowerCase()))
  ), [rows, action, entity, actor])

  const actions = useMemo(() => [...new Set((rows ?? []).map((r) => r.action))].sort(), [rows])
  const entities = useMemo(() => [...new Set((rows ?? []).map((r) => r.entity))].sort(), [rows])

  return (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => navigate('/owner')} aria-label="Back" className="w-9 h-9 rounded-lg bg-white border border-gray-200 flex items-center justify-center text-gray-600">
        <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
      </button>
      <div>
        <h1 className="text-xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-xs text-gray-500">Who changed what, when — newest first</p>
      </div>

      <div className="flex gap-2">
        <select value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action"
                className="flex-1 h-10 px-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700">
          <option value="">All actions</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filter by entity"
                className="flex-1 h-10 px-2 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700">
          <option value="">All entities</option>
          {entities.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Search actor…" aria-label="Search actor"
             className="w-full h-10 px-3 rounded-lg border border-gray-200 bg-white text-xs" />

      {err && (
        <div className="bg-white border border-red-100 rounded-lg p-4 space-y-2">
          <p className="text-xs text-red-500">{err}</p>
          <button onClick={load} className="h-9 px-3 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700">Retry</button>
        </div>
      )}
      {!err && rows === null && <Skel lines={3} h="h-20" />}
      {!err && rows !== null && shown.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-lg px-3.5 py-6 text-sm text-gray-500 text-center">
          {(rows ?? []).length === 0 ? 'No audit entries yet.' : 'No entries match these filters.'}
        </div>
      )}

      <div className="space-y-2">
        {shown.map((r) => (
          <div key={r.id} data-testid="audit-row" className="bg-white border border-gray-200 rounded-lg p-3.5">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">
                  {r.actor_name} <span className="text-gray-400 font-normal">· {r.actor_role || 'system'}</span>
                </div>
                <div className="text-[11px] text-gray-500">{new Date(r.created_at).toLocaleString()}</div>
                <div className="text-xs text-gray-700">{describe(r)}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-bold uppercase px-2 py-1 rounded-full bg-gray-100 text-gray-600">{r.action}</span>
                {r.reason && (
                  <span title={r.reason} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-100 max-w-[8rem] truncate">
                    ⚑ {r.reason}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-2 text-xs text-gray-600">
              {r.entity} <span className="text-gray-400 font-mono">{String(r.entity_id ?? '').slice(0, 8)}</span>
            </div>
            {summarize(r) && <div className="mt-1 text-xs text-gray-800">{summarize(r)}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}
