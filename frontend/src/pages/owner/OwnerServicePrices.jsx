import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { listPatients, listPriceExceptions, upsertPriceException, deletePriceException, peso } from '../../lib/api'

// Per-patient custom prices — the group-chat-member-picker flow (Figma frame 73).

export default function OwnerServicePrices() {
  const [params] = useSearchParams()
  const serviceId = params.get('service')
  const serviceName = params.get('name') || 'Service'
  const base = Number(params.get('base') || 0)

  const [patients, setPatients] = useState(null)
  const [exceptions, setExceptions] = useState([]) // {patient_id, price, name}
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!serviceId) return
    listPatients().then(setPatients).catch((e) => setErr(e.message))
    listPriceExceptions(serviceId).then(setExceptions).catch(() => {})
  }, [serviceId])

  const exceptionFor = (pid) => exceptions.find((x) => x.patient_id === pid)

  const toggle = async (p, draftPrice) => {
    const existing = exceptionFor(p.id)
    if (existing) {
      await deletePriceException(serviceId, p.id)
      setExceptions((x) => x.filter((e) => e.patient_id !== p.id))
    } else {
      const price = Number(draftPrice) || base
      await upsertPriceException(serviceId, p.id, price)
      setExceptions((x) => [...x, { patient_id: p.id, price, name: p.full_name }])
    }
  }

  const setPrice = async (p, value) => {
    const price = Number(value)
    if (!price || price <= 0) return
    await upsertPriceException(serviceId, p.id, price)
    setExceptions((x) => x.map((e) => (e.patient_id === p.id ? { ...e, price } : e)))
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  if (!serviceId) return <p className="px-4 py-10 text-sm text-gray-400">Open this screen from a service in Manage.</p>

  const filtered = (patients ?? []).filter((p) => p.full_name?.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="px-4 py-4 space-y-3">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Custom Prices</h1>
        <p className="text-xs text-gray-500">Manage · {serviceName}</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3.5">
        <div className="flex justify-between items-center">
          <span className="text-sm font-semibold text-gray-900">{serviceName}</span>
          <span className="text-sm font-bold text-gray-900">{peso(base)}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">Base price for everyone: <b>{peso(base)}</b>. Tap a patient to set their custom price — like adding members to a group chat.</p>
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search patients…"
             className="w-full h-10 border border-gray-200 rounded-lg px-3 text-sm bg-white" />

      <h2 className="text-[11px] font-bold uppercase tracking-wide text-primary-700">{exceptions.length} exception{exceptions.length !== 1 ? 's' : ''} set</h2>

      {err && <p className="text-xs text-red-500">{err}</p>}
      {!patients && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="space-y-2">
        {filtered.map((p) => {
          const exc = exceptionFor(p.id)
          const on = !!exc
          return (
            <div key={p.id} className={'bg-white border rounded-lg px-3.5 py-2.5 flex items-center gap-3 ' + (on ? 'border-primary-600 bg-primary-50' : 'border-gray-200')}>
              <span className="w-9 h-9 rounded-full bg-primary-50 text-primary-700 text-xs font-bold flex items-center justify-center flex-none">
                {(p.full_name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-gray-900 truncate">{p.full_name}</span>
                <span className="block text-[11px] text-gray-500">{p.email || '—'}</span>
              </span>
              {on ? (
                <input type="number" defaultValue={exc.price} onBlur={(e) => setPrice(p, e.target.value)} aria-label="Custom price"
                       className="w-20 h-9 border border-primary-600 rounded-lg px-2 text-sm font-bold text-right bg-white" />
              ) : (
                <span className="text-xs text-gray-400 w-20 text-right">{peso(base)}</span>
              )}
              <button onClick={() => toggle(p)} aria-label={on ? 'Remove custom price' : 'Set custom price'}
                      className={'w-6 h-6 rounded-full border-2 flex items-center justify-center flex-none ' + (on ? 'border-primary-600 bg-primary-600' : 'border-gray-300')}>
                {on && <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5L20 7" /></svg>}
              </button>
            </div>
          )
        })}
      </div>

      {saved && <p className="text-xs text-green-600 text-center">Saved ✓</p>}
      <p className="text-[11px] text-gray-400 text-center pr-16 pb-20">Tap the circle to add/remove an exception · edit the price inline</p>
    </div>
  )
}
